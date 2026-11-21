"""Truck routes from Valhalla."""

from __future__ import annotations

import asyncio
import re
from collections import defaultdict
from collections.abc import Sequence
from itertools import accumulate

import httpx
from asgiref.sync import async_to_sync
from django.conf import settings
from django.core.cache import cache

from .errors import UpstreamError, ValidationProblem
from .geo import cumulative_miles, decode_polyline, haversine_mi, out_and_back_spans
from .types import LatLon, Place, RouteCandidate

TIMEOUT = httpx.Timeout(10.0, connect=5.0)
# Whole routing step, so a slow router yields a clean 502 well inside a worker timeout.
ROUTING_BUDGET_S = 18.0
CACHE_TTL_S = 20 * 60

LB_TO_TONNES = 0.000453592
# Valhalla's truck weight is the gross vehicle weight, so the rig itself has to be added to the
# cargo. 35,000 lb is a typical tractor with an empty 53 ft trailer.
TRUCK_TARE_LB = 35_000
MAX_GROSS_LB = 80_000  # US federal gross limit on Interstates

VALHALLA_NO_ROUTE_CODES = {170, 171, 442, 443}
# The public instance rejects requests whose locations span more than 1,500 km (932 mi) in a
# straight line. Checking first, with a small margin, saves a request that cannot succeed.
VALHALLA_MAX_CROW_MI = 925.0
NO_ROUTE = "No truck route was found between these places."
TOO_FAR = (
    "This trip is longer than the routing service accepts (about 925 miles in a straight line)."
)
ROAD_REF = re.compile(r"^(I|US|SR|[A-Z]{2})[ -]?(\d+[A-Z]?)\b")
# OSM also tags ramps and short stretches with the number spelled out ("South Interstate 45").
SPELLED_REF = re.compile(
    r"^(?:(?:north|south|east|west)\s+)?"
    r"(interstate|u\.?s\.?\s+(?:highway|route)|state\s+highway|state\s+route)\s+(\d+[A-Z]?)\b",
    re.IGNORECASE,
)
SPELLED_PREFIX = {"interstate": "I", "state highway": "SH", "state route": "SR"}
SIDE_ROAD = re.compile(r"\b(frontage|service|access)\s+road\b", re.IGNORECASE)
NORMALISED_REF = re.compile(r"^[A-Z]{1,2}-\d")
# A road carrying under this share of the named mileage is a ramp or a town street, not a "via".
MIN_VIA_SHARE = 0.02


def fetch_route(origin: Place, destination: Place, cargo_lb: float = 0) -> RouteCandidate:
    """The fastest truck route. Re-plans of the same trip are cached."""
    ends = [(origin.lat, origin.lon), (destination.lat, destination.lon)]
    if haversine_mi(*ends) > VALHALLA_MAX_CROW_MI:
        raise ValidationProblem(TOO_FAR, field="destination")
    weight_t = truck_weight_t(cargo_lb)
    key = (
        f"route:v1:{origin.lat:.4f}:{origin.lon:.4f}:{destination.lat:.4f}:{destination.lon:.4f}"
        f":{weight_t}"
    )
    cached = cache.get(key)
    if cached is not None:
        return cached
    route = async_to_sync(_fetch_route)(ends, weight_t)
    cache.set(key, route, CACHE_TTL_S)
    return route


def truck_weight_t(cargo_lb: float) -> float:
    """Gross vehicle weight in metric tonnes, as Valhalla's truck costing expects."""
    return round(min(TRUCK_TARE_LB + cargo_lb, MAX_GROSS_LB) * LB_TO_TONNES, 2)


async def _fetch_route(ends: Sequence[LatLon], weight_t: float) -> RouteCandidate:
    async with httpx.AsyncClient(
        timeout=TIMEOUT, headers={"User-Agent": settings.HTTP_USER_AGENT}
    ) as client:
        try:
            async with asyncio.timeout(ROUTING_BUDGET_S):
                return await _valhalla(client, ends, weight_t)
        except TimeoutError as exc:
            raise UpstreamError("The routing service took too long to respond.") from exc


async def _valhalla(
    client: httpx.AsyncClient, stops: Sequence[LatLon], weight_t: float
) -> RouteCandidate:
    body = {
        "locations": [{"lat": lat, "lon": lon, "type": "break"} for lat, lon in stops],
        "costing": "truck",
        "costing_options": {"truck": {"weight": weight_t}},
        "units": "miles",
        "directions_options": {"units": "miles", "directions_type": "maneuvers"},
    }

    try:
        response = await client.post(f"{settings.VALHALLA_URL.rstrip('/')}/route", json=body)
    except httpx.HTTPError as exc:
        raise UpstreamError("The routing service is unavailable.") from exc
    payload = _json(response)
    if response.status_code != 200:
        if payload.get("error_code") in VALHALLA_NO_ROUTE_CODES:
            raise ValidationProblem(NO_ROUTE, field="destination")
        raise UpstreamError(f"The routing service failed ({response.status_code}).")
    try:
        return _from_valhalla(payload["trip"])
    except (KeyError, TypeError, ValueError, IndexError) as exc:
        raise UpstreamError("The routing service returned an unexpected response.") from exc


def _pairs(stops: Sequence[LatLon]) -> list[tuple[LatLon, LatLon]]:
    return list(zip(stops, stops[1:], strict=False))


def _from_valhalla(trip: dict) -> RouteCandidate:
    points: list[LatLon] = []
    segment_seconds: list[float] = []
    names: dict[str, float] = defaultdict(float)
    first_seen: dict[str, int] = {}
    for leg in trip["legs"]:
        shape = decode_polyline(leg["shape"], 6)
        # Consecutive legs share their joint point; drop it so indices stay contiguous.
        base = len(points) - 1 if points else 0
        points.extend(shape[1:] if points else shape)
        segment_seconds.extend([0.0] * (len(points) - 1 - len(segment_seconds)))
        for maneuver in leg["maneuvers"]:
            begin = base + int(maneuver["begin_shape_index"])
            end = base + int(maneuver["end_shape_index"])
            _spread(points, segment_seconds, begin, end, float(maneuver.get("time", 0.0)))
            name = road_name(maneuver.get("street_names") or [])
            if name:
                names[name] += float(maneuver.get("length", 0.0))
                first_seen.setdefault(name, len(first_seen))

    summary = trip["summary"]
    return _candidate(
        points,
        segment_seconds,
        distance_mi=float(summary["length"]),
        duration_s=float(summary["time"]),
        via=main_roads(names, first_seen),
    )


def _spread(
    points: list[LatLon], segment_seconds: list[float], begin: int, end: int, seconds: float
) -> None:
    """Share a maneuver's time among its shape segments in proportion to their length."""
    if seconds <= 0 or not segment_seconds:
        return
    begin = min(begin, len(segment_seconds) - 1)
    end = min(max(end, begin + 1), len(segment_seconds))
    lengths = [haversine_mi(points[i], points[i + 1]) for i in range(begin, end)]
    total = sum(lengths)
    for offset, length in enumerate(lengths):
        share = length / total if total > 0 else 1 / len(lengths)
        segment_seconds[begin + offset] += seconds * share


def road_name(street_names: Sequence[str]) -> str | None:
    """Prefer a route number ("I 80 Expr", "South Interstate 45" -> "I-80", "I-45").

    Frontage and service roads are skipped: they run beside the highway the route is really on.
    """
    names = [n.strip() for n in street_names if n.strip() and not SIDE_ROAD.search(n)]
    for raw in names:
        ref = _road_ref(raw)
        if ref:
            return ref
    return names[0] if names else None


def _road_ref(raw: str) -> str | None:
    match = ROAD_REF.match(raw)
    if match:
        return f"{match.group(1)}-{match.group(2)}"
    match = SPELLED_REF.match(raw)
    if match:
        kind = " ".join(match.group(1).lower().replace(".", "").split())
        prefix = "US" if kind.startswith("us") else SPELLED_PREFIX[kind]
        return f"{prefix}-{match.group(2).upper()}"
    return None


def main_roads(lengths: dict[str, float], first_seen: dict[str, int]) -> list[str]:
    """Up to three of the longest roads, in driving order.

    When any numbered route is known, street names are left out: "I-45" says more to a driver
    than the downtown street the trip starts on.
    """
    refs = [n for n in lengths if NORMALISED_REF.match(n)]
    pool = refs or list(lengths)
    total = sum(lengths[n] for n in pool)
    top = sorted(pool, key=lambda n: lengths[n], reverse=True)[:3]
    kept = [n for i, n in enumerate(top) if i == 0 or lengths[n] >= total * MIN_VIA_SHARE]
    return sorted(kept, key=lambda n: first_seen[n])


def _candidate(
    points: list[LatLon],
    segment_seconds: list[float],
    *,
    distance_mi: float,
    duration_s: float,
    via: list[str],
) -> RouteCandidate:
    if len(points) < 2:
        raise ValueError("route geometry is too short")
    points, segment_seconds, distance_mi, duration_s = _without_spurs(
        points, segment_seconds, distance_mi, duration_s
    )
    segment_miles = [haversine_mi(a, b) for a, b in _pairs(points)]
    # Rescale so the last values match the router's own totals exactly; the per-point shape of
    # each series is what carries the information.
    cum_miles = _scaled([0.0, *accumulate(segment_miles)], distance_mi)
    cum_seconds = _scaled([0.0, *accumulate(segment_seconds)], duration_s)
    return RouteCandidate(
        points=points,
        cum_miles=cum_miles,
        cum_seconds=cum_seconds,
        distance_mi=distance_mi,
        duration_s=duration_s,
        via=via,
    )


def _without_spurs(
    points: list[LatLon], segment_seconds: list[float], distance_mi: float, duration_s: float
) -> tuple[list[LatLon], list[float], float, float]:
    """Drop stretches the route drives out and straight back along.

    Valhalla occasionally sends a truck off the highway and turns it around at a roundabout. The
    truck ends up where it started, so the stretch only adds miles and hours to every later ETA.
    """
    spans = out_and_back_spans(points)
    if not spans:
        return points, segment_seconds, distance_mi, duration_s
    raw_miles, raw_seconds = cumulative_miles(points)[-1], sum(segment_seconds)
    kept_points: list[LatLon] = []
    kept_seconds: list[float] = []
    resume = 0
    for start, end in spans:
        kept_points.extend(points[resume : start + 1])
        # The two ends of a spur are a few metres apart, so the hop between them takes no time.
        kept_seconds.extend([*segment_seconds[resume:start], 0.0])
        resume = end
    kept_points.extend(points[resume:])
    kept_seconds.extend(segment_seconds[resume:])
    # The router's totals shrink by what was cut, measured with its own per-segment times, so a
    # spur driven slowly (a ramp, a roundabout) costs what it really cost.
    if raw_miles > 0:
        distance_mi *= cumulative_miles(kept_points)[-1] / raw_miles
    if raw_seconds > 0:
        duration_s *= sum(kept_seconds) / raw_seconds
    return kept_points, kept_seconds, distance_mi, duration_s


def _scaled(values: list[float], total: float) -> list[float]:
    current = values[-1]
    if current <= 0:
        # No usable per-point data: spread evenly so later points still come later.
        step = total / (len(values) - 1)
        return [i * step for i in range(len(values))]
    factor = total / current
    return [v * factor for v in values]


def _json(response: httpx.Response) -> dict:
    try:
        payload = response.json()
    except ValueError:
        return {}
    return payload if isinstance(payload, dict) else {}
