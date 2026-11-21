"""Hourly forecast lookups from Open-Meteo.

The free tier is metered per location (about 600 a minute), so points are snapped to a grid and
de-duplicated before anything goes over the wire. The grid is 0.1 degree (~7 mi, finer than the
forecast models) unless that would put more than MAX_LOCATIONS cells in one lookup; see
`grid_step`. Results are cached per cell and hour so overlapping routes and re-plans share them.
"""

from __future__ import annotations

import asyncio
from collections.abc import Iterable, Sequence
from datetime import UTC, datetime, timedelta

import httpx
from asgiref.sync import async_to_sync
from django.conf import settings
from django.core.cache import cache

from .errors import UpstreamError
from .types import WeatherSample

GRID_DEG = 0.1
# Well inside the ~600 a minute allowance, leaving room for a re-plan in the same minute. A
# 1,000 mile trip at 10 mile spacing and a coast-to-coast one at 25 (three routes) stay on the
# fine grid.
MAX_LOCATIONS = 350
MAX_GRID_TENTHS = 10
BATCH_SIZE = 100
CONCURRENCY = 4
CACHE_TTL_S = 30 * 60
MAX_ATTEMPTS = 2
BACKOFF_S = 0.5
# An ETA past the end of the returned series may use the last hour, but never a stale one.
MAX_HOUR_GAP = timedelta(hours=3)
TIMEOUT = httpx.Timeout(8.0, connect=5.0)
# All batches together, so a struggling upstream yields a clean 502 inside a worker timeout.
FETCH_BUDGET_S = 12.0
# Open-Meteo meters locations, not hours, so each request also takes the hours around the trip.
# A re-plan with a shifted departure then reads the cache instead.
WINDOW_PAD_BEFORE = timedelta(hours=3)
WINDOW_PAD_AFTER = timedelta(hours=12)

# `rain` covers large-scale rain only; convective downpours arrive as `showers`. `precipitation`
# is not requested because it also folds in snowfall, which is reported on its own.
HOURLY_VARS = (
    "wind_speed_10m",
    "wind_gusts_10m",
    "rain",
    "showers",
    "snowfall",
    "temperature_2m",
    "weather_code",
)

UNAVAILABLE = "Weather forecast is unavailable right now. Try again shortly."

Cell = tuple[float, float]
Key = tuple[Cell, datetime]
Series = dict[datetime, WeatherSample]


def fetch_for_points(samples: Sequence[tuple[float, float, datetime]]) -> list[WeatherSample]:
    """Forecast at each (lat, lon, time), using the hour nearest that time. Order is preserved."""
    step = grid_step([(lat, lon) for lat, lon, _ in samples])
    wanted = [(snap(lat, lon, step), nearest_hour(at)) for lat, lon, at in samples]
    table = _load(set(wanted))
    return [table[key] for key in wanted]


def fetch_cells(cells: Iterable[Cell], hours: Iterable[datetime]) -> dict[Key, WeatherSample]:
    """Forecast for every cell at every hour, keyed by (cell, hour).

    Cells must already sit on the 0.1 degree grid (see `snap`) so they share the cache with
    plans; hours are whole UTC hours.
    """
    return _load({(cell, nearest_hour(hour)) for cell in cells for hour in hours})


def grid_step(points: Sequence[tuple[float, float]]) -> float:
    """The finest grid, in tenths of a degree, that keeps one lookup within MAX_LOCATIONS.

    Only very long trips at tight spacing widen it: New York to Los Angeles at 10 mile spacing
    has ~800 distinct 0.1 degree cells over three routes and lands on 0.4 degree (~25 mi),
    still finer than the frontal systems that drive wind, rain and snow. Every checkpoint keeps
    its own ETA hour. Coordinates stay multiples of 0.1, so coarse cells share the fine cache.
    """
    for tenths in range(1, MAX_GRID_TENTHS + 1):
        step = tenths / 10
        if len({snap(lat, lon, step) for lat, lon in points}) <= MAX_LOCATIONS:
            return step
    return MAX_GRID_TENTHS / 10


def snap(lat: float, lon: float, step: float = GRID_DEG) -> Cell:
    # Adding 0.0 folds -0.0 into 0.0 so both spellings share a cache entry.
    return (round(round(lat / step) * step, 1) + 0.0, round(round(lon / step) * step, 1) + 0.0)


def nearest_hour(at: datetime) -> datetime:
    return (_to_utc(at) + timedelta(minutes=30)).replace(minute=0, second=0, microsecond=0)


def _to_utc(at: datetime) -> datetime:
    return at.astimezone(UTC) if at.tzinfo else at.replace(tzinfo=UTC)


def _cache_key(key: Key) -> str:
    (lat, lon), hour = key
    return f"wx:v1:{lat:.1f}:{lon:.1f}:{hour:%Y%m%d%H}"


def _load(keys: set[Key]) -> dict[Key, WeatherSample]:
    if not keys:
        return {}
    by_cache_key = {_cache_key(key): key for key in keys}
    found = {by_cache_key[ck]: value for ck, value in cache.get_many(list(by_cache_key)).items()}
    missing = keys - found.keys()
    if not missing:
        return found

    fetched = async_to_sync(_fetch_all)(_plan_batches(missing))
    cache.set_many(
        {
            _cache_key((cell, hour)): s
            for cell, series in fetched.items()
            for hour, s in series.items()
        },
        CACHE_TTL_S,
    )
    for cell, hour in missing:
        found[(cell, hour)] = _pick(fetched.get(cell, {}), hour)
    return found


def _plan_batches(missing: Iterable[Key]) -> list[tuple[list[Cell], datetime, datetime]]:
    """Group cells into batches with a shared, padded hour window.

    Cells are sorted by the first hour they need, so cells near the start of a trip land in the
    same batch and each request spans roughly the hours its cells need.
    """
    spans: dict[Cell, tuple[datetime, datetime]] = {}
    for cell, hour in missing:
        lo, hi = spans.get(cell, (hour, hour))
        spans[cell] = (min(lo, hour), max(hi, hour))
    ordered = sorted(spans, key=lambda c: (spans[c][0], c))
    batches = []
    for i in range(0, len(ordered), BATCH_SIZE):
        cells = ordered[i : i + BATCH_SIZE]
        start = min(spans[c][0] for c in cells) - WINDOW_PAD_BEFORE
        end = max(spans[c][1] for c in cells) + WINDOW_PAD_AFTER
        batches.append((cells, start, end))
    return batches


def _pick(series: Series, hour: datetime) -> WeatherSample:
    if hour in series:
        return series[hour]
    if series:
        closest = min(series, key=lambda h: abs(h - hour))
        if abs(closest - hour) <= MAX_HOUR_GAP:
            return series[closest]
    raise UpstreamError("The weather forecast does not cover the full trip window.")


async def _fetch_all(batches: list[tuple[list[Cell], datetime, datetime]]) -> dict[Cell, Series]:
    gate = asyncio.Semaphore(CONCURRENCY)
    async with httpx.AsyncClient(
        timeout=TIMEOUT, headers={"User-Agent": settings.HTTP_USER_AGENT}
    ) as client:

        async def run(batch):
            async with gate:
                return await _fetch_batch(client, *batch)

        try:
            async with asyncio.timeout(FETCH_BUDGET_S):
                results = await asyncio.gather(*(run(b) for b in batches), return_exceptions=True)
        except TimeoutError as exc:
            raise UpstreamError(UNAVAILABLE) from exc

    merged: dict[Cell, Series] = {}
    for result in results:
        if isinstance(result, BaseException):
            raise result
        merged.update(result)
    return merged


async def _fetch_batch(
    client: httpx.AsyncClient, cells: list[Cell], start: datetime, end: datetime
) -> dict[Cell, Series]:
    params = {
        "latitude": ",".join(f"{lat:.1f}" for lat, _ in cells),
        "longitude": ",".join(f"{lon:.1f}" for _, lon in cells),
        "hourly": ",".join(HOURLY_VARS),
        "wind_speed_unit": "mph",
        "precipitation_unit": "inch",
        "temperature_unit": "fahrenheit",
        "timezone": "UTC",
        "start_hour": f"{start:%Y-%m-%dT%H:%M}",
        "end_hour": f"{end:%Y-%m-%dT%H:%M}",
    }
    url = f"{settings.OPEN_METEO_URL.rstrip('/')}/v1/forecast"

    for attempt in range(MAX_ATTEMPTS):
        try:
            response = await client.get(url, params=params)
        except httpx.TransportError:
            response = None
        if response is not None and response.status_code < 400:
            return _parse(response, cells)
        if response is not None and response.status_code != 429 and response.status_code < 500:
            # A 4xx other than rate limiting is a request we built wrong; retrying will not help.
            raise UpstreamError(UNAVAILABLE)
        if attempt + 1 < MAX_ATTEMPTS:
            await asyncio.sleep(BACKOFF_S * 2**attempt)
    raise UpstreamError(UNAVAILABLE)


def _parse(response: httpx.Response, cells: list[Cell]) -> dict[Cell, Series]:
    try:
        payload = response.json()
        # A single-location request returns an object instead of a one-element list.
        locations = payload if isinstance(payload, list) else [payload]
        if len(locations) != len(cells):
            raise ValueError("location count mismatch")
        return {
            cell: _parse_series(loc["hourly"]) for cell, loc in zip(cells, locations, strict=True)
        }
    except (ValueError, KeyError, TypeError, IndexError) as exc:
        raise UpstreamError("The weather service returned an unexpected response.") from exc


def _parse_series(hourly: dict) -> Series:
    series: Series = {}
    # Some models never report showers; treat a missing series as none.
    showers = hourly.get("showers") or [None] * len(hourly["time"])
    for i, stamp in enumerate(hourly["time"]):
        hour = datetime.fromisoformat(stamp).replace(tzinfo=UTC)
        series[hour] = WeatherSample(
            # A missing reading is treated as calm/dry rather than failing the whole plan.
            wind_mph=_number(hourly["wind_speed_10m"][i], 0.0),
            gust_mph=_number(hourly["wind_gusts_10m"][i], 0.0),
            # Rounded so pairs such as 0.01 + 0.09 sum to 0.10, not 0.09999999999999999.
            rain_in_h=round(_number(hourly["rain"][i], 0.0) + _number(showers[i], 0.0), 6),
            snow_in_h=_number(hourly["snowfall"][i], 0.0),
            temp_f=_number(hourly["temperature_2m"][i], None),
            weather_code=_code(hourly["weather_code"][i]),
        )
    return series


def _number(value, default):
    return default if value is None else float(value)


def _code(value) -> int | None:
    return None if value is None else int(value)
