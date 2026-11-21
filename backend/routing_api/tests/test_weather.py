import asyncio
from datetime import UTC, datetime, timedelta

import httpx
import pytest
import respx
from django.core.cache import cache

from routing_api.services import weather
from routing_api.services.errors import UpstreamError
from routing_api.services.types import WeatherSample

URL = "https://api.open-meteo.com/v1/forecast"
T0 = datetime(2026, 11, 21, 14, tzinfo=UTC)


@pytest.fixture(autouse=True)
def isolated(settings, monkeypatch):
    settings.OPEN_METEO_URL = "https://api.open-meteo.com"
    monkeypatch.setattr(weather, "BACKOFF_S", 0)
    cache.clear()
    yield
    cache.clear()


def fake_forecast(request: httpx.Request) -> httpx.Response:
    """Open-Meteo stand-in: wind encodes the cell and hour so tests can see what was picked.

    wind = lat + hour-of-day / 100, rain = lon / 1000 (absolute).
    """
    params = request.url.params
    lats = [float(v) for v in params["latitude"].split(",")]
    lons = [float(v) for v in params["longitude"].split(",")]
    start = datetime.fromisoformat(params["start_hour"])
    end = datetime.fromisoformat(params["end_hour"])
    hours = []
    while start <= end:
        hours.append(start)
        start += timedelta(hours=1)
    locations = [
        {
            "latitude": lat,
            "longitude": lon,
            "hourly": {
                "time": [h.strftime("%Y-%m-%dT%H:%M") for h in hours],
                "wind_speed_10m": [lat + h.hour / 100 for h in hours],
                "wind_gusts_10m": [None for _ in hours],
                "rain": [abs(lon) / 1000 for _ in hours],
                "snowfall": [0.0 for _ in hours],
                "temperature_2m": [30.5 for _ in hours],
                "weather_code": [3 for _ in hours],
            },
        }
        for lat, lon in zip(lats, lons, strict=True)
    ]
    return httpx.Response(200, json=locations[0] if len(locations) == 1 else locations)


@pytest.fixture
def api():
    with respx.mock(assert_all_called=False) as mock:
        route = mock.get(URL).mock(side_effect=fake_forecast)
        yield route


def test_empty_input_makes_no_request(api):
    assert weather.fetch_for_points([]) == []
    assert api.call_count == 0


def test_snaps_to_grid_and_picks_nearest_hour(api):
    (sample,) = weather.fetch_for_points([(41.87, -87.63, T0 + timedelta(minutes=31))])
    # 41.87 -> 41.9, 14:31 -> 15:00
    assert sample.wind_mph == pytest.approx(41.9 + 0.15)
    assert sample.rain_in_h == pytest.approx(0.0876)
    assert sample.gust_mph == 0.0
    assert (sample.temp_f, sample.weather_code) == (30.5, 3)

    params = api.calls.last.request.url.params
    assert params["latitude"] == "41.9" and params["longitude"] == "-87.6"
    # The window is padded around the hour that is actually needed.
    assert (params["start_hour"], params["end_hour"]) == ("2026-11-21T12:00", "2026-11-22T03:00")
    assert params["wind_speed_unit"] == "mph"
    assert "showers" in params["hourly"].split(",")
    assert params["precipitation_unit"] == "inch"
    assert params["timezone"] == "UTC"


def test_half_hour_rounds_up_and_earlier_rounds_down(api):
    early, half = weather.fetch_for_points(
        [(10.0, 10.0, T0 + timedelta(minutes=29)), (10.0, 10.0, T0 + timedelta(minutes=30))]
    )
    assert early.wind_mph == pytest.approx(10.14)
    assert half.wind_mph == pytest.approx(10.15)


def test_preserves_order_and_dedupes_cells(api):
    samples = [
        (40.01, -100.01, T0),
        (45.0, -90.0, T0 + timedelta(hours=2)),
        (40.04, -100.04, T0),  # same cell and hour as the first point
    ]
    first, second, third = weather.fetch_for_points(samples)
    assert first == third
    assert second.wind_mph == pytest.approx(45.16)
    assert api.call_count == 1
    params = api.calls.last.request.url.params
    assert params["latitude"].split(",") == ["40.0", "45.0"]


def test_negative_zero_shares_a_cell():
    assert weather.snap(-0.04, 0.04) == weather.snap(0.04, -0.04) == (0.0, 0.0)


def test_batches_of_at_most_one_hundred(api):
    samples = [(30 + i * 0.1, -90.0, T0) for i in range(250)]
    results = weather.fetch_for_points(samples)
    assert len(results) == 250
    assert api.call_count == 3
    sizes = sorted(len(c.request.url.params["latitude"].split(",")) for c in api.calls)
    assert sizes == [50, 100, 100]


def test_cache_avoids_second_request(api):
    samples = [(41.9, -87.6, T0), (39.7, -105.0, T0 + timedelta(hours=10))]
    weather.fetch_for_points(samples)
    weather.fetch_for_points(samples)
    assert api.call_count == 1


def test_shifted_departure_reuses_the_padded_window(api):
    weather.fetch_for_points([(41.9, -87.6, T0)])
    shifted = weather.fetch_for_points(
        [(41.9, -87.6, T0 + timedelta(hours=2)), (41.9, -87.6, T0 - timedelta(hours=2))]
    )
    assert api.call_count == 1
    assert [s.wind_mph for s in shifted] == pytest.approx([42.06, 42.02])


def test_cache_is_per_hour(api):
    weather.fetch_for_points([(41.9, -87.6, T0)])
    beyond = T0 + weather.WINDOW_PAD_AFTER + timedelta(hours=1)
    weather.fetch_for_points([(41.9, -87.6, beyond)])
    assert api.call_count == 2


@pytest.mark.parametrize("status", [429, 503])
def test_retries_rate_limit_and_server_errors_once(status):
    with respx.mock as mock:
        route = mock.get(URL).mock(side_effect=[httpx.Response(status), fake_forecast])
        (sample,) = weather.fetch_for_points([(41.9, -87.6, T0)])
    assert route.call_count == 2
    assert sample.wind_mph == pytest.approx(42.04)


def test_retries_network_errors():
    with respx.mock as mock:
        route = mock.get(URL).mock(side_effect=[httpx.ConnectTimeout("slow"), fake_forecast])
        weather.fetch_for_points([(41.9, -87.6, T0)])
    assert route.call_count == 2


def test_gives_up_after_repeated_server_errors():
    with respx.mock as mock:
        route = mock.get(URL).mock(return_value=httpx.Response(500))
        with pytest.raises(UpstreamError):
            weather.fetch_for_points([(41.9, -87.6, T0)])
    assert route.call_count == weather.MAX_ATTEMPTS == 2


def test_slow_upstream_is_cut_off_by_the_budget(monkeypatch):
    async def stalled(*args):
        await asyncio.sleep(5)

    monkeypatch.setattr(weather, "_fetch_batch", stalled)
    monkeypatch.setattr(weather, "FETCH_BUDGET_S", 0.05)
    with pytest.raises(UpstreamError):
        weather.fetch_for_points([(41.9, -87.6, T0)])


def test_batches_run_concurrently_but_bounded(monkeypatch):
    in_flight = peak = 0

    async def slow_batch(client, cells, start, end):
        nonlocal in_flight, peak
        in_flight += 1
        peak = max(peak, in_flight)
        await asyncio.sleep(0.01)
        in_flight -= 1
        return {cell: {T0: WeatherSample(1, 2, 0, 0)} for cell in cells}

    monkeypatch.setattr(weather, "_fetch_batch", slow_batch)
    monkeypatch.setattr(weather, "BATCH_SIZE", 10)
    weather.fetch_for_points([(30 + i * 0.1, -90.0, T0) for i in range(100)])
    assert peak == weather.CONCURRENCY


def test_client_error_is_not_retried():
    with respx.mock as mock:
        route = mock.get(URL).mock(return_value=httpx.Response(400, json={"error": True}))
        with pytest.raises(UpstreamError):
            weather.fetch_for_points([(41.9, -87.6, T0)])
    assert route.call_count == 1


def test_showers_count_as_rain():
    def stormy(request):
        body = fake_forecast(request).json()
        body["hourly"]["showers"] = [0.2 for _ in body["hourly"]["time"]]
        return httpx.Response(200, json=body)

    with respx.mock as mock:
        mock.get(URL).mock(side_effect=stormy)
        (sample,) = weather.fetch_for_points([(41.9, -87.6, T0)])
    assert sample.rain_in_h == pytest.approx(0.0876 + 0.2)


@pytest.mark.parametrize(
    ("rain", "showers", "total"),
    [(0.01, 0.09, 0.1), (0.012, 0.088, 0.1), (0.15, 0.10, 0.25), (None, 0.03, 0.03)],
)
def test_rain_and_showers_sum_without_float_noise(rain, showers, total):
    # Plain float addition gives 0.09999999999999999 for the first two pairs.
    hourly = {
        "time": ["2026-11-21T14:00"],
        "wind_speed_10m": [5.0],
        "wind_gusts_10m": [8.0],
        "rain": [rain],
        "showers": [showers],
        "snowfall": [0.0],
        "temperature_2m": [40.0],
        "weather_code": [61],
    }
    (sample,) = weather._parse_series(hourly).values()
    assert sample.rain_in_h == total


def test_malformed_payload_is_upstream_error():
    with respx.mock as mock:
        mock.get(URL).mock(return_value=httpx.Response(200, json={"unexpected": 1}))
        with pytest.raises(UpstreamError):
            weather.fetch_for_points([(41.9, -87.6, T0)])


def test_series_shorter_than_requested_uses_closest_hour_within_limit():
    def truncated(request):
        """A series that ends at T0, however far the request asked."""
        response = fake_forecast(request)
        body = response.json()
        hourly = body["hourly"]
        keep = hourly["time"].index(f"{T0:%Y-%m-%dT%H:%M}") + 1
        for name in hourly:
            hourly[name] = hourly[name][:keep]
        return httpx.Response(200, json=body)

    with respx.mock as mock:
        mock.get(URL).mock(side_effect=truncated)
        a, b = weather.fetch_for_points([(41.9, -87.6, T0), (41.9, -87.6, T0 + timedelta(hours=2))])
    assert a == b

    cache.clear()
    with respx.mock as mock:
        mock.get(URL).mock(side_effect=truncated)
        with pytest.raises(UpstreamError):
            weather.fetch_for_points([(41.9, -87.6, T0), (41.9, -87.6, T0 + timedelta(hours=5))])


def test_short_trips_stay_on_the_fine_grid():
    points = [(40.0 + i * 0.1, -100.0) for i in range(weather.MAX_LOCATIONS)]
    assert weather.grid_step(points) == 0.1


def test_long_trips_widen_the_grid_until_the_lookup_fits(api):
    # A straight line of 900 fine cells, like New York to Los Angeles at 10 mile spacing.
    samples = [(35.0, -120.0 + i * 0.05, T0 + timedelta(minutes=10 * i)) for i in range(900)]
    step = weather.grid_step([(lat, lon) for lat, lon, _ in samples])
    assert step == 0.2
    results = weather.fetch_for_points(samples)
    assert len(results) == 900
    cells = {
        (float(lat), float(lon))
        for call in api.calls
        for lat, lon in zip(
            call.request.url.params["latitude"].split(","),
            call.request.url.params["longitude"].split(","),
            strict=True,
        )
    }
    assert len(cells) <= weather.MAX_LOCATIONS
    # Coarse cells are still written with one decimal, so they share the fine cache keys.
    assert all(round(lon * 10) % 2 == 0 for _, lon in cells)


def test_grid_never_fails_a_plan_however_many_points():
    points = [(30 + (i % 300) * 0.1, -120 + (i // 300) * 0.5) for i in range(6000)]
    assert weather.grid_step(points) == weather.MAX_GRID_TENTHS / 10


def test_coarse_snap_keeps_one_decimal():
    assert weather.snap(41.87, -87.63, 0.5) == (42.0, -87.5)
    assert weather.snap(41.87, -87.63, 0.3) == (42.0, -87.6)
    assert weather.snap(-0.1, 0.1, 0.5) == (0.0, 0.0)


def test_sends_user_agent(api, settings):
    settings.HTTP_USER_AGENT = "safe-route-test/1.0"
    weather.fetch_for_points([(41.9, -87.6, T0)])
    assert api.calls.last.request.headers["user-agent"] == "safe-route-test/1.0"
