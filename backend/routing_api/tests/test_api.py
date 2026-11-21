from datetime import UTC, datetime, timedelta

import pytest

from routing_api.services import geocoding, planner
from routing_api.services.errors import UpstreamError, ValidationProblem
from routing_api.services.types import Place, RouteCandidate

CHICAGO = {"lat": 41.878, "lon": -87.629, "label": "Chicago, IL"}
DENVER = {"lat": 39.739, "lon": -104.990, "label": "Denver, CO"}
NOW = datetime(2026, 11, 21, 13, 30, tzinfo=UTC)
DEPARTURE = datetime(2026, 11, 21, 14, 0, tzinfo=UTC)


@pytest.fixture(autouse=True)
def frozen_now(monkeypatch):
    monkeypatch.setattr("routing_api.serializers.timezone.now", lambda: NOW)


def body(**overrides):
    data = {
        "origin": CHICAGO,
        "destination": DENVER,
        "departure": DEPARTURE.isoformat(),
        "spacing_mi": 25,
    }
    data.update(overrides)
    return data


def post(client, data):
    return client.post("/api/plan", data, content_type="application/json")


@pytest.fixture
def plan_calls(monkeypatch):
    calls = []

    def fake_plan_trip(**kwargs):
        calls.append(kwargs)
        return {"notices": [], "routes": []}

    monkeypatch.setattr(planner, "plan_trip", fake_plan_trip)
    return calls


def test_plan_passes_validated_input_to_the_planner(client, plan_calls):
    departure = "2026-11-21T08:00:00-06:00"
    response = post(client, body(departure=departure, spacing_mi="10"))
    assert response.status_code == 200
    (call,) = plan_calls
    assert call["origin"] == Place(41.878, -87.629, "Chicago, IL")
    assert call["destination"] == Place(39.739, -104.99, "Denver, CO")
    assert call["spacing_mi"] == 10 and isinstance(call["spacing_mi"], int)
    assert call["departure"] == DEPARTURE


def candidate(lat, minutes, via, points=2, source="valhalla"):
    line = [(lat - i * 0.0001, -87.629 - i * 0.001) for i in range(points)]
    duration = minutes * 60 + 0.4
    return RouteCandidate(
        points=line,
        cum_miles=[i * 1016.44 / (points - 1) for i in range(points)],
        cum_seconds=[i * duration / (points - 1) for i in range(points)],
        distance_mi=1016.44,
        duration_s=duration,
        via=via,
        source=source,
    )


def test_plan_returns_routes_fastest_first_with_light_geometry(client, monkeypatch):
    routes = [
        candidate(41.878, 950, ["I-80"], points=17_000),
        candidate(41.9, 900, ["I-88", "I-80", "I-76"]),
        candidate(41.7, 1000, ["I-70"]),
    ]
    seen = []

    def fake_fetch(origin, destination, cargo_lb=0, max_routes=3):
        seen.append((cargo_lb, max_routes))
        return routes

    monkeypatch.setattr(planner.routing, "fetch_routes", fake_fetch)

    payload = post(client, body(departure="2026-11-21T08:00:00-06:00")).json()
    assert seen == [(0, 3)]
    assert payload["departure"] == "2026-11-21T14:00:00Z"
    assert payload["spacing_mi"] == 25
    assert payload["notices"] == ["ETAs assume continuous driving and do not include rest breaks."]
    assert [r["id"] for r in payload["routes"]] == ["A", "B", "C"]
    assert [r["label"] for r in payload["routes"]] == ["Route A", "Route B", "Route C"]
    first, second, _ = payload["routes"]
    assert first["via"] == ["I-88", "I-80", "I-76"]
    assert first["distance_mi"] == 1016.4
    assert first["duration_s"] == 54000
    # 900 minutes after 14:00 UTC.
    assert first["arrival"] == "2026-11-22T05:00:00Z"
    stops = first["checkpoints"]
    assert [c["index"] for c in stops] == list(range(len(stops)))
    assert [c["mile"] for c in stops[:3]] == [0, 25, 50]
    assert stops[-1]["mile"] == 1016.4
    assert len(stops) == 42
    assert stops[0] == {
        "index": 0,
        "mile": 0,
        "lat": 41.9,
        "lon": -87.629,
        "eta": "2026-11-21T14:00:00Z",
    }
    assert stops[-1]["eta"] == first["arrival"]
    # Constant speed in this fixture: 25 of 1016.44 miles take the same share of 900 minutes.
    assert stops[1]["eta"] == "2026-11-21T14:22:08Z"
    coords = second["geometry"]["coordinates"]
    assert second["geometry"]["type"] == "LineString"
    assert 2 <= len(coords) <= planner.MAX_GEOMETRY_POINTS
    assert coords[0] == [-87.629, 41.878]


@pytest.mark.parametrize(
    ("routes", "notices"),
    [
        ([candidate(41.9, 300, ["I-80"])], ["Only one route was available for this trip."]),
        (
            [candidate(41.9, 300, ["I-80"]), candidate(41.7, 350, ["I-70"])],
            ["Only 2 distinct routes were available for this trip."],
        ),
    ],
)
def test_plan_says_when_fewer_routes_exist(client, monkeypatch, routes, notices):
    monkeypatch.setattr(planner.routing, "fetch_routes", lambda *a, **k: routes)
    payload = post(client, body()).json()
    assert payload["notices"] == notices
    assert len(payload["routes"]) == len(routes)


def test_plan_warns_when_routes_ignore_truck_restrictions(client, monkeypatch):
    routes = [candidate(41.9 - i * 0.1, 300 + i, ["I-80"], source="osrm") for i in range(3)]
    monkeypatch.setattr(planner.routing, "fetch_routes", lambda *a, **k: routes)
    (notice,) = post(client, body()).json()["notices"]
    assert "may not respect truck restrictions" in notice


def test_plan_with_no_routes_is_a_400_on_destination(client, monkeypatch):
    monkeypatch.setattr(planner.routing, "fetch_routes", lambda *a, **k: [])
    response = post(client, body())
    assert response.status_code == 400
    assert response.json()["field"] == "destination"


@pytest.mark.parametrize(
    ("overrides", "field", "message"),
    [
        ({"origin": {"lat": 91, "lon": 0}}, "origin.lat", "Latitude must be between -90 and 90."),
        (
            {"destination": {"lat": 0, "lon": -181}},
            "destination.lon",
            "Longitude must be between -180 and 180.",
        ),
        ({"origin": {"lat": True, "lon": 0}}, "origin.lat", "Latitude must be a number."),
        ({"origin": None}, "origin", "Choose an origin."),
        ({"destination": None}, "destination", "Choose a destination."),
        ({"departure": "tomorrow"}, "departure", "Departure must be an ISO 8601 date and time."),
        ({"departure": None}, "departure", "Choose a departure date and time."),
        ({"spacing_mi": 30}, "spacing_mi", "Checkpoint spacing must be 10, 25 or 50 miles."),
        ({"spacing_mi": None}, "spacing_mi", "Choose a checkpoint spacing."),
        (
            {"destination": {"lat": 41.879, "lon": -87.630}},
            "destination",
            "Origin and destination must be more than 1 mile apart.",
        ),
    ],
)
def test_plan_validation_errors(client, plan_calls, overrides, field, message):
    response = post(client, body(**overrides))
    assert response.status_code == 400
    assert response.json() == {"error": message, "field": field}
    assert plan_calls == []


@pytest.mark.parametrize("missing", ["origin", "destination", "departure", "spacing_mi"])
def test_plan_required_fields(client, plan_calls, missing):
    data = body()
    del data[missing]
    response = post(client, data)
    assert response.status_code == 400
    assert response.json()["field"] == missing


@pytest.mark.parametrize(
    ("departure", "error"),
    [
        (NOW - timedelta(minutes=59), None),
        (NOW - timedelta(minutes=61), "Departure cannot be more than 1 hour in the past."),
        (NOW + timedelta(days=7) - timedelta(minutes=1), None),
        (NOW + timedelta(days=7, minutes=1), "Departure must be within the next 7 days."),
    ],
)
def test_departure_window(client, plan_calls, departure, error):
    response = post(client, body(departure=departure.isoformat()))
    if error is None:
        assert response.status_code == 200
    else:
        assert response.status_code == 400
        assert response.json() == {"error": error, "field": "departure"}
        assert plan_calls == []


def test_departure_window_applies_to_the_instant_not_the_wall_clock(client, plan_calls):
    # 06:00 in Denver is 13:00 UTC, half an hour before "now": allowed.
    assert post(client, body(departure="2026-11-21T06:00:00-07:00")).status_code == 200
    # 06:00 in New York is 11:00 UTC, two and a half hours ago: refused.
    response = post(client, body(departure="2026-11-21T06:00:00-05:00"))
    assert response.status_code == 400
    assert response.json()["field"] == "departure"


@pytest.mark.parametrize("spacing", [10, 25, 50])
def test_every_spacing_choice_is_accepted(client, plan_calls, spacing):
    assert post(client, body(spacing_mi=spacing)).status_code == 200
    assert plan_calls[0]["spacing_mi"] == spacing


def test_invalid_json(client, plan_calls):
    response = client.post("/api/plan", "{not json", content_type="application/json")
    assert response.status_code == 400
    assert response.json() == {"error": "Request body must be valid JSON."}


def test_plan_is_post_only(client):
    assert client.get("/api/plan").status_code == 405


def test_upstream_failure_is_502(client, monkeypatch):
    def broken(**kwargs):
        raise UpstreamError("The routing service is unavailable.")

    monkeypatch.setattr(planner, "plan_trip", broken)
    response = post(client, body())
    assert response.status_code == 502
    assert response.json() == {"error": "The routing service is unavailable."}


def test_service_validation_problem_is_400_with_field(client, monkeypatch):
    def unroutable(**kwargs):
        raise ValidationProblem("No truck route was found between these places.", "destination")

    monkeypatch.setattr(planner, "plan_trip", unroutable)
    response = post(client, body())
    assert response.status_code == 400
    assert response.json() == {
        "error": "No truck route was found between these places.",
        "field": "destination",
    }


def test_geocode(client, monkeypatch):
    seen = []
    result = {
        "label": "Chicago, Illinois, United States",
        "name": "Chicago",
        "lat": 41.87,
        "lon": -87.62,
    }

    def fake_search(query, limit=5):
        seen.append(query)
        return [result]

    monkeypatch.setattr(geocoding, "search", fake_search)
    response = client.get("/api/geocode", {"q": "  chicago "})
    assert response.status_code == 200
    assert response.json() == {"results": [result]}
    assert seen == ["chicago"]


@pytest.mark.parametrize("query", [None, "", "c", " c "])
def test_geocode_needs_two_characters(client, monkeypatch, query):
    monkeypatch.setattr(geocoding, "search", lambda *a, **k: pytest.fail("should not search"))
    params = {} if query is None else {"q": query}
    response = client.get("/api/geocode", params)
    assert response.status_code == 400
    assert response.json() == {"error": "Enter at least 2 characters to search.", "field": "q"}


def test_geocode_upstream_failure(client, monkeypatch):
    def broken(query, limit=5):
        raise UpstreamError("Place search is unavailable right now. Try again shortly.")

    monkeypatch.setattr(geocoding, "search", broken)
    response = client.get("/api/geocode", {"q": "denver"})
    assert response.status_code == 502
    assert response.json()["error"].startswith("Place search is unavailable")
