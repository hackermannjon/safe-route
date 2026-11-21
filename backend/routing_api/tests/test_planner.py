from dataclasses import replace
from datetime import UTC, datetime, timedelta

import pytest

from routing_api.services import planner, routing, weather
from routing_api.services.geo import cumulative_miles
from routing_api.services.types import Place, RouteCandidate, WeatherSample

DEPARTURE = datetime(2026, 11, 21, 14, tzinfo=UTC)
ORIGIN = Place(40.0, -100.0, "Origin")
DESTINATION = Place(40.0, -98.0, "Destination")


def straight_route(lat, seconds_per_mile):
    """East-west line from -100 to -98 longitude with a shape point every ~0.5 mile."""
    points = [(lat, -100 + i * 0.01) for i in range(201)]
    cum = cumulative_miles(points)
    return RouteCandidate(
        points=points,
        cum_miles=cum,
        cum_seconds=[m * seconds_per_mile for m in cum],
        distance_mi=cum[-1],
        duration_s=cum[-1] * seconds_per_mile,
    )


def fake_weather(lat, lon, eta):
    """Wind encodes the route's latitude, rain the minutes since departure, so pairing shows."""
    minutes = (eta - DEPARTURE) / timedelta(minutes=1)
    return WeatherSample(lat, lat + 10, minutes / 10_000, 0.0123456, -3.04, 71)


@pytest.fixture
def weather_calls(monkeypatch):
    calls = []

    def fetch(samples):
        calls.append(list(samples))
        return [fake_weather(*s) for s in samples]

    monkeypatch.setattr(weather, "fetch_for_points", fetch)
    return calls


@pytest.fixture(autouse=True)
def two_routes(monkeypatch):
    routes = [straight_route(41.0, 70), straight_route(40.0, 60)]
    monkeypatch.setattr(routing, "fetch_routes", lambda *a, **k: routes)
    return routes


def plan(spacing_mi=10):
    return planner.plan_trip(ORIGIN, DESTINATION, DEPARTURE, spacing_mi)


def test_one_weather_lookup_covers_every_route_at_each_eta(weather_calls):
    result = plan()
    (call,) = weather_calls
    stops = [c for r in result["routes"] for c in r["checkpoints"]]
    assert len(call) == len(stops)
    assert [(lat, lon) for lat, lon, _ in call] == [(c["lat"], c["lon"]) for c in stops]
    assert [eta.strftime("%Y-%m-%dT%H:%M:%SZ") for _, _, eta in call] == [c["eta"] for c in stops]


def test_each_checkpoint_gets_the_sample_for_its_own_place_and_time(weather_calls):
    fast, slow = plan()["routes"]
    assert {c["weather"]["wind_mph"] for c in fast["checkpoints"]} == {40.0}
    assert {c["weather"]["wind_mph"] for c in slow["checkpoints"]} == {41.0}
    last = slow["checkpoints"][-1]
    minutes = (datetime.fromisoformat(last["eta"]) - DEPARTURE) / timedelta(minutes=1)
    assert last["weather"]["rain_in_h"] == round(minutes / 10_000, 3)


def test_weather_payload_is_rounded_for_display(weather_calls):
    first = plan()["routes"][0]["checkpoints"][0]
    assert first["weather"] == {
        "wind_mph": 40.0,
        "gust_mph": 50.0,
        "rain_in_h": 0.0,
        "snow_in_h": 0.012,
        "temp_f": -3.0,
        "weather_code": 71,
    }


def test_missing_temperature_stays_null(monkeypatch):
    monkeypatch.setattr(
        weather, "fetch_for_points", lambda samples: [WeatherSample(1, 2, 0, 0) for _ in samples]
    )
    first = plan(50)["routes"][0]["checkpoints"][0]
    assert first["weather"]["temp_f"] is None
    assert first["weather"]["weather_code"] is None


def with_source(route, source):
    return replace(route, source=source)


@pytest.mark.parametrize(
    ("sources", "notice"),
    [
        (("valhalla", "valhalla"), None),
        (
            ("valhalla", "osrm"),
            "Route B comes from a general road router because truck routing could not finish, "
            "and may not respect truck restrictions.",
        ),
        (
            ("osrm", "osrm"),
            "Truck routing was unavailable, so routes come from a general road router "
            "and may not respect truck restrictions.",
        ),
    ],
)
def test_notices_name_the_routes_that_are_not_truck_aware(sources, notice):
    routes = [
        with_source(straight_route(40.0, 60), sources[0]),
        with_source(straight_route(40.2, 66), sources[1]),
    ]
    notices = planner._notices(routes)
    router_notices = [n for n in notices if "general road router" in n]
    assert router_notices == ([notice] if notice else [])
