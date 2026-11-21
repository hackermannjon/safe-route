from dataclasses import replace
from datetime import UTC, datetime, timedelta

import pytest

from routing_api.services import planner, routing, weather
from routing_api.services.geo import cumulative_miles, haversine_mi
from routing_api.services.planner import AssessedCheckpoint, Span
from routing_api.services.types import (
    Checkpoint,
    Place,
    RiskAssessment,
    RiskLevel,
    RouteCandidate,
    WeatherSample,
)

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


def plan(spacing_mi=10, cargo_lb=0):
    return planner.plan_trip(ORIGIN, DESTINATION, DEPARTURE, spacing_mi, cargo_lb)


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


L = RiskLevel
CALM = WeatherSample(5, 10, 0, 0)


def at(mile, level):
    checkpoint = Checkpoint(0, mile, 0.0, 0.0, DEPARTURE)
    return AssessedCheckpoint(checkpoint, CALM, RiskAssessment(level, "wind"))


def test_each_stretch_takes_the_worse_end_and_equal_neighbours_merge():
    points = [at(0, L.LOW), at(10, L.HIGH), at(20, L.LOW), at(30, L.LOW), at(35, L.MODERATE)]
    spans = planner.merge_spans(points)
    assert spans == [Span(L.HIGH, 0, 20), Span(L.LOW, 20, 30), Span(L.MODERATE, 30, 35)]
    assert planner.miles_by_level(spans) == {
        L.LOW: 10,
        L.MODERATE: 5,
        L.HIGH: 20,
        L.SEVERE: 0,
        L.NO_TRAVEL: 0,
    }
    # (2 * 20 + 0 * 10 + 1 * 5) / 35 miles.
    assert planner.average_risk(spans) == pytest.approx(45 / 35)


def test_a_single_bad_checkpoint_colours_both_stretches_beside_it():
    spans = planner.merge_spans([at(0, L.LOW), at(25, L.SEVERE), at(50, L.LOW)])
    assert spans == [Span(L.SEVERE, 0, 50)]
    assert planner.average_risk(spans) == 3


def test_destination_level_counts_for_the_last_stretch():
    spans = planner.merge_spans([at(0, L.LOW), at(25, L.LOW), at(31.5, L.NO_TRAVEL)])
    assert spans == [Span(L.LOW, 0, 25), Span(L.NO_TRAVEL, 25, 31.5)]


def test_average_risk_of_an_empty_route_is_zero():
    assert planner.average_risk([]) == 0.0


def corridor_weather(samples):
    """Heavy rain around mile 25 and strong wind from mile ~95 on, everywhere else calm."""
    out = []
    for _, lon, _ in samples:
        if -99.6 < lon < -99.4:
            out.append(WeatherSample(10, 15, 0.3, 0))
        elif lon > -98.2:
            out.append(WeatherSample(47, 60, 0, 0))
        else:
            out.append(CALM)
    return out


@pytest.fixture
def one_route(monkeypatch):
    route = straight_route(40.0, 60)
    monkeypatch.setattr(routing, "fetch_routes", lambda *a, **k: [route])
    monkeypatch.setattr(weather, "fetch_for_points", corridor_weather)
    return route


def test_route_risk_summary_on_a_hand_checked_route(one_route):
    (route,) = plan(spacing_mi=25)["routes"]
    stops = route["checkpoints"]
    total = stops[-1]["mile"]
    assert [c["mile"] for c in stops] == [0, 25, 50, 75, 100, total]
    assert [c["level"] for c in stops] == ["LOW", "HIGH", "LOW", "LOW", "SEVERE", "SEVERE"]
    assert [c["factor"] for c in stops] == ["wind", "rain", "wind", "wind", "wind", "wind"]
    assert [f["properties"] for f in route["segments"]["features"]] == [
        {"level": "HIGH", "from_mi": 0, "to_mi": 50},
        {"level": "LOW", "from_mi": 50, "to_mi": 75},
        {"level": "SEVERE", "from_mi": 75, "to_mi": total},
    ]
    assert route["risk"] == {
        "worst_level": "SEVERE",
        "avg_risk": round((2 * 50 + 3 * (total - 75)) / total, 2),
        "miles": {
            "LOW": 25,
            "MODERATE": 0,
            "HIGH": 50,
            "SEVERE": round(total - 75, 1),
            "NO_TRAVEL": 0,
        },
    }


def test_heavy_cargo_turns_the_windy_stretch_into_no_travel(one_route):
    result = plan(spacing_mi=25, cargo_lb=42_000)
    (route,) = result["routes"]
    windy = route["checkpoints"][-1]
    assert (windy["level"], windy["factor"]) == ("NO_TRAVEL", "load")
    assert windy["load_rule"] == "Wind 45 to under 55 mph with cargo over 30,000 lb"
    assert route["risk"]["worst_level"] == "NO_TRAVEL"
    assert route["segments"]["features"][-1]["properties"]["level"] == "NO_TRAVEL"
    assert result["cargo_lb"] == 42_000
    assert result["notices"][-1].startswith("Every route crosses No Travel conditions")


def test_segments_are_continuous_and_end_at_the_checkpoints(one_route):
    (route,) = plan(spacing_mi=25)["routes"]
    features = route["segments"]["features"]
    by_mile = {c["mile"]: [c["lon"], c["lat"]] for c in route["checkpoints"]}
    for feature in features:
        line = feature["geometry"]["coordinates"]
        start, end = feature["properties"]["from_mi"], feature["properties"]["to_mi"]
        assert line[0] == pytest.approx(by_mile[start], abs=1e-5)
        assert line[-1] == pytest.approx(by_mile[end], abs=1e-5)
        length = sum(
            haversine_mi((a[1], a[0]), (b[1], b[0])) for a, b in zip(line, line[1:], strict=False)
        )
        assert length == pytest.approx(end - start, abs=0.1)
    for a, b in zip(features, features[1:], strict=False):
        assert a["geometry"]["coordinates"][-1] == b["geometry"]["coordinates"][0]


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
    notices = planner._notices(routes, [[], []])
    router_notices = [n for n in notices if "general road router" in n]
    assert router_notices == ([notice] if notice else [])
