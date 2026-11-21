import gzip
import json
import math
from datetime import UTC, datetime, timedelta

import httpx
import pytest
import respx
from django.core.cache import cache

from routing_api.services import heatmap, weather
from routing_api.services.geo import haversine_mi

URL = "https://api.open-meteo.com/v1/forecast"
NOW = datetime(2026, 11, 21, 13, 30, tzinfo=UTC)
DEPARTURE = datetime(2026, 11, 21, 14, 20, tzinfo=UTC)
START = datetime(2026, 11, 21, 14, tzinfo=UTC)

# Orlando to Savannah and New York to Los Angeles, as straight-ish polylines in (lat, lon).
SHORT = [(28.54 + (32.08 - 28.54) * i / 50, -81.38 + (81.38 - 81.09) * i / 50) for i in range(51)]
LONG = [(40.71 - (40.71 - 34.05) * i / 300, -74.0 - (118.24 - 74.0) * i / 300) for i in range(301)]
LONG_SOUTH = [(lat - 1.5 * math.sin(i / 300 * math.pi), lon) for i, (lat, lon) in enumerate(LONG)]


@pytest.fixture(autouse=True)
def isolated(settings, monkeypatch):
    settings.OPEN_METEO_URL = "https://api.open-meteo.com"
    monkeypatch.setattr(weather, "BACKOFF_S", 0)
    monkeypatch.setattr("routing_api.serializers.timezone.now", lambda: NOW)
    cache.clear()
    yield
    cache.clear()


def fake_forecast(request: httpx.Request) -> httpx.Response:
    """Calm for the first day after START, then 40 mph wind and 0.299 in/h of rain.

    Snow is 0.5 in/h north of 30 degrees, so a cell's latitude shows in the snow frames.
    """
    params = request.url.params
    lats = [float(v) for v in params["latitude"].split(",")]
    lons = params["longitude"].split(",")
    start = datetime.fromisoformat(params["start_hour"]).replace(tzinfo=UTC)
    end = datetime.fromisoformat(params["end_hour"]).replace(tzinfo=UTC)
    count = int((end - start).total_seconds() // 3600) + 1
    hours = [start + timedelta(hours=h) for h in range(count)]
    stormy = [h >= START + timedelta(hours=24) for h in hours]

    def location(lat):
        return {
            "hourly": {
                "time": [h.strftime("%Y-%m-%dT%H:%M") for h in hours],
                "wind_speed_10m": [40.0 if s else 10.9 for s in stormy],
                "wind_gusts_10m": [50.0 for _ in hours],
                "rain": [0.299 if s else 0.0 for s in stormy],
                "showers": [0.0 for _ in hours],
                "snowfall": [0.5 if lat > 30 else 0.0 for _ in hours],
                "temperature_2m": [60.0 for _ in hours],
                "weather_code": [3 for _ in hours],
            }
        }

    locations = [location(lat) for lat in lats]
    assert len(locations) == len(lons)
    return httpx.Response(200, json=locations[0] if len(locations) == 1 else locations)


@pytest.fixture
def api():
    with respx.mock(assert_all_called=False) as mock:
        yield mock.get(URL).mock(side_effect=fake_forecast)


def centres(grid):
    return [grid.center(i) for i in grid.cells]


def distance_to(samples, point):
    return min(haversine_mi(point, s) for s in samples)


def test_samples_every_ten_miles_with_both_ends():
    line = [(40.0, -100.0), (40.0, -99.0), (40.0, -98.0)]
    samples = heatmap.corridor_samples([line])
    assert samples[0] == line[0] and samples[-1] == line[-1]
    gaps = [haversine_mi(a, b) for a, b in zip(samples, samples[1:], strict=False)]
    # Spacing carries over vertices rather than restarting at each one; only the end is closer.
    assert gaps[:-1] == pytest.approx([heatmap.SAMPLE_MI] * (len(gaps) - 1), abs=1e-3)
    assert gaps[-1] <= heatmap.SAMPLE_MI


def test_grid_covers_the_buffer_and_nothing_far_beyond():
    grid = heatmap.build_grid([SHORT])
    samples = heatmap.corridor_samples([SHORT])
    inside = centres(grid)
    assert all(distance_to(samples, c) <= heatmap.BUFFER_MI + 0.5 for c in inside)
    # Every cell centre that is well inside the buffer is part of the corridor.
    every = [grid.center(i) for i in range(grid.rows * grid.cols)]
    missing = [c for c in every if distance_to(samples, c) < heatmap.BUFFER_MI - 1]
    assert set(missing) <= set(inside)


def test_short_trip_uses_a_fine_grid_on_cache_cells():
    grid = heatmap.build_grid([SHORT])
    assert grid.dlat <= 0.2
    assert 100 < len(grid.cells) <= heatmap.MAX_CELLS
    for lat, lon in centres(grid):
        assert round(lat * 10) == pytest.approx(lat * 10, abs=1e-9)
        assert round(lon * 10) == pytest.approx(lon * 10, abs=1e-9)


def test_coast_to_coast_widens_the_grid_to_stay_within_budget():
    grid = heatmap.build_grid([LONG, LONG_SOUTH])
    assert len(grid.cells) <= heatmap.MAX_CELLS
    assert grid.dlat >= 0.4
    # Roughly square cells on the ground: longitude steps are wider in degrees.
    assert grid.dlon > grid.dlat
    # The finest step that fits was chosen.
    finer = heatmap._grid(heatmap.corridor_samples([LONG, LONG_SOUTH]), round(grid.dlat * 10) - 1)
    assert len(finer.cells) > heatmap.MAX_CELLS


def test_alternative_routes_widen_the_corridor():
    one = heatmap.build_grid([LONG])
    both = heatmap.build_grid([LONG, LONG_SOUTH])
    area = len(one.cells) * one.dlat * one.dlon
    assert len(both.cells) * both.dlat * both.dlon > area


def test_payload_has_every_hour_for_every_cell(api):
    payload = heatmap.corridor_heatmap([SHORT], DEPARTURE, cargo_lb=42_000)
    grid = payload["grid"]
    cells = payload["cells"]
    assert cells == sorted(cells) and len(cells) <= heatmap.MAX_CELLS
    assert all(0 <= i < grid["rows"] * grid["cols"] for i in cells)
    hours = payload["hours"]
    assert len(hours) == heatmap.HOURS == 49
    # 14:20 rounds to 14:00, like a checkpoint ETA.
    assert hours[0] == "2026-11-21T14:00:00Z" and hours[-1] == "2026-11-23T14:00:00Z"
    assert payload["departure"] == "2026-11-21T14:20:00Z"
    assert payload["cargo_lb"] == 42_000
    assert set(payload["values"]) == {"risk", "wind_mph", "rain_in_h", "snow_in_h"}
    for metric in payload["values"].values():
        assert len(metric["frames"]) == 49
        assert {len(frame) for frame in metric["frames"]} == {len(cells)}
        assert all(isinstance(v, int) for frame in metric["frames"] for v in frame)


def test_values_are_truncated_integers_with_a_scale(api):
    values = heatmap.corridor_heatmap([SHORT], DEPARTURE, cargo_lb=0)["values"]
    assert values["wind_mph"]["scale"] == 1 and values["rain_in_h"]["scale"] == 0.01
    assert set(values["wind_mph"]["frames"][0]) == {10}
    assert set(values["wind_mph"]["frames"][24]) == {40}
    # 0.299 in/h is shown as 0.29, never rounded up to 0.30.
    assert set(values["rain_in_h"]["frames"][24]) == {29}


def test_risk_per_cell_and_hour_uses_the_checkpoint_rules(api):
    heavy = heatmap.corridor_heatmap([SHORT], DEPARTURE, cargo_lb=42_000)
    light = heatmap.corridor_heatmap([SHORT], DEPARTURE, cargo_lb=10_000)
    centres_lat = [lat for lat, _ in centres(heatmap.build_grid([SHORT]))]
    calm, stormy = heavy["values"]["risk"]["frames"][0], heavy["values"]["risk"]["frames"][24]
    # Calm: snow of 0.5 in/h is Moderate north of 30 degrees, Low south of it.
    assert calm == [1 if lat > 30 else 0 for lat in centres_lat]
    # 40 mph is High on its own and Severe with more than 40,000 lb aboard.
    assert set(stormy) == {3}
    assert set(light["values"]["risk"]["frames"][24]) == {2}


def test_one_window_covers_all_hours_and_the_cache_is_shared(api):
    heatmap.corridor_heatmap([SHORT], DEPARTURE, cargo_lb=0)
    calls = api.call_count
    cells = len(heatmap.build_grid([SHORT]).cells)
    assert calls == math.ceil(cells / weather.BATCH_SIZE)
    params = api.calls.last.request.url.params
    assert params["start_hour"] == "2026-11-21T11:00"
    assert params["end_hour"] == "2026-11-24T02:00"

    # A second look, and a plan through the same cells, read the cache.
    heatmap.corridor_heatmap([SHORT], DEPARTURE + timedelta(minutes=5), cargo_lb=42_000)
    lat, lon = centres(heatmap.build_grid([SHORT]))[0]
    weather.fetch_for_points([(lat, lon, START + timedelta(hours=5))])
    assert api.call_count == calls


def test_payload_stays_small(api):
    payload = heatmap.corridor_heatmap([LONG, LONG_SOUTH], DEPARTURE, cargo_lb=42_000)
    raw = json.dumps(payload, separators=(",", ":")).encode()
    assert len(gzip.compress(raw)) < 40_000


# API


def body(**overrides):
    data = {
        "departure": DEPARTURE.isoformat(),
        "cargo_lb": 42_000,
        "routes": [[[lon, lat] for lat, lon in SHORT]],
    }
    data.update(overrides)
    return data


def post(client, data):
    return client.post("/api/heatmap", data, content_type="application/json")


def test_heatmap_endpoint(client, api):
    response = post(client, body(cargo_lb="42000"))
    assert response.status_code == 200
    payload = response.json()
    assert payload["cargo_lb"] == 42_000
    assert len(payload["hours"]) == 49
    assert payload["grid"]["dlat"] == heatmap.build_grid([SHORT]).dlat


def test_a_plan_left_on_screen_past_its_departure_still_gets_a_map(client, api):
    response = post(client, body(departure=(NOW - timedelta(hours=2)).isoformat()))
    assert response.status_code == 200
    assert response.json()["hours"][0] == "2026-11-21T12:00:00Z"


@pytest.mark.parametrize(
    ("overrides", "field", "message"),
    [
        ({"routes": []}, "routes", "Send between 1 and 3 routes."),
        ({"routes": [[[0, 0]]] * 4}, "routes", "Send between 1 and 3 routes."),
        ({"routes": None}, "routes", "Send the planned routes."),
        (
            {"routes": [[[-81.0, 28.0]]]},
            "routes",
            "Each route must be a list of at least 2 [longitude, latitude] points.",
        ),
        (
            {"routes": [[[-81.0, 28.0], [-81.0, "x"]]]},
            "routes",
            "Each route must be a list of at least 2 [longitude, latitude] points.",
        ),
        (
            {"routes": [[[-81.0, 28.0], [True, 29.0]]]},
            "routes",
            "Each route must be a list of at least 2 [longitude, latitude] points.",
        ),
        (
            {"routes": [[[-81.0, 28.0], [-81.0, 95.0]]]},
            "routes",
            "Route points must be valid longitudes and latitudes.",
        ),
        (
            {"routes": [[[-81.0, 28.0]] * 5_001]},
            "routes",
            "A route can have at most 5,000 points.",
        ),
        ({"cargo_lb": 80_001}, "cargo_lb", "Cargo weight cannot exceed 80,000 lb."),
        (
            {"departure": (NOW - timedelta(hours=13)).isoformat()},
            "departure",
            "Departure cannot be more than 12 hours in the past.",
        ),
        (
            {"departure": (NOW + timedelta(days=8)).isoformat()},
            "departure",
            "Departure must be within the next 7 days (weather forecast range).",
        ),
    ],
)
def test_heatmap_validation(client, api, overrides, field, message):
    response = post(client, body(**overrides))
    assert response.status_code == 400
    assert response.json() == {"error": message, "field": field}
    assert api.call_count == 0


@pytest.mark.parametrize("missing", ["departure", "cargo_lb", "routes"])
def test_heatmap_required_fields(client, api, missing):
    data = body()
    del data[missing]
    response = post(client, data)
    assert response.status_code == 400
    assert response.json()["field"] == missing


def test_weather_outage_is_a_clean_502(client):
    with respx.mock as mock:
        mock.get(URL).mock(return_value=httpx.Response(503))
        response = post(client, body())
    assert response.status_code == 502
    assert response.json() == {"error": weather.UNAVAILABLE}


def test_heatmap_is_post_only(client):
    assert client.get("/api/heatmap").status_code == 405
