import asyncio
import json
from pathlib import Path

import httpx
import pytest
import respx
from django.conf import settings
from django.core.cache import cache

from routing_api.services import routing
from routing_api.services.errors import UpstreamError, ValidationProblem
from routing_api.services.geo import cumulative_miles, haversine_mi, out_and_back_spans
from routing_api.services.types import Place

FIXTURE = Path(__file__).parent / "fixtures" / "valhalla_chicago_denver.json"
VALHALLA = f"{settings.VALHALLA_URL}/route"

CHICAGO = Place(41.878, -87.629, "Chicago, IL")
DENVER = Place(39.739, -104.990, "Denver, CO")
LOS_ANGELES = Place(34.052, -118.244, "Los Angeles, CA")


@pytest.fixture(autouse=True)
def empty_cache():
    cache.clear()
    yield
    cache.clear()


@pytest.fixture(scope="module")
def chicago_denver():
    return json.loads(FIXTURE.read_text())


def encode_polyline(points, precision=6):
    factor = 10**precision
    out = []
    prev_lat = prev_lon = 0
    for lat, lon in points:
        ilat, ilon = round(lat * factor), round(lon * factor)
        for delta in (ilat - prev_lat, ilon - prev_lon):
            value = ~(delta << 1) if delta < 0 else delta << 1
            while value >= 0x20:
                out.append(chr((0x20 | (value & 0x1F)) + 63))
                value >>= 5
            out.append(chr(value + 63))
        prev_lat, prev_lon = ilat, ilon
    return "".join(out)


def densify(stops, per_leg=40):
    points = [stops[0]]
    for (lat1, lon1), (lat2, lon2) in zip(stops, stops[1:], strict=False):
        for k in range(1, per_leg + 1):
            t = k / per_leg
            points.append((lat1 + (lat2 - lat1) * t, lon1 + (lon2 - lon1) * t))
    return points


def synthetic_trip(stops, mph=60.0, road="I 70"):
    """Straight-line Valhalla trip through the given stops, one maneuver per stop-to-stop hop."""
    points = densify(stops)
    length = sum(haversine_mi(a, b) for a, b in zip(points, points[1:], strict=False)) * 1.1
    time = length / mph * 3600
    hops = len(stops) - 1
    per_hop = (len(points) - 1) // hops
    maneuvers = [
        {
            "type": 1,
            "street_names": [road],
            "length": length / hops,
            "time": time / hops,
            "begin_shape_index": i * per_hop,
            "end_shape_index": (i + 1) * per_hop,
        }
        for i in range(hops)
    ]
    end = len(points) - 1
    maneuvers.append(
        {"type": 4, "length": 0.0, "time": 0.0, "begin_shape_index": end, "end_shape_index": end}
    )
    return {
        "legs": [{"shape": encode_polyline(points), "maneuvers": maneuvers}],
        "summary": {"length": length, "time": time},
    }


def test_parses_recorded_valhalla_response(chicago_denver):
    main = routing._from_valhalla(chicago_denver["trip"])
    summary = chicago_denver["trip"]["summary"]

    # The recording exits and U-turns back onto I-80 four times (about 2.5 mi in all); those
    # loops are cut, so the totals come in just under the router's.
    assert summary["length"] - 4 < main.distance_mi < summary["length"] - 1
    assert summary["time"] - 600 < main.duration_s < summary["time"]
    assert out_and_back_spans(main.points) == []
    assert len(main.points) == len(main.cum_miles) == len(main.cum_seconds)
    assert main.cum_miles[-1] == pytest.approx(main.distance_mi)
    assert main.cum_seconds[0] == 0
    assert main.cum_seconds[-1] == pytest.approx(main.duration_s)
    assert all(b >= a for a, b in zip(main.cum_seconds, main.cum_seconds[1:], strict=False))
    assert main.points[0] == pytest.approx((41.878, -87.629), abs=0.01)
    assert main.points[-1] == pytest.approx((39.739, -104.990), abs=0.05)
    assert main.via == ["I-88", "I-80", "I-76"]


def test_out_and_back_to_a_side_road_is_cut():
    # The route leaves the interstate for a side road 3 mi north and drives straight back down
    # before carrying on.
    west, junction, side_road, east = (
        (40.67, -99.6),
        (40.67, -99.03),
        (40.7135, -99.03),
        (40.67, -98.4),
    )
    stops = [west, junction, side_road, junction, east]
    trip = synthetic_trip(stops)
    route = routing._from_valhalla(trip)

    assert max(lat for lat, _ in route.points) == pytest.approx(junction[0])
    kept_share = cumulative_miles(route.points)[-1] / cumulative_miles(densify(stops))[-1]
    spur_mi = 2 * haversine_mi(junction, side_road)
    assert kept_share == pytest.approx(1 - spur_mi / (spur_mi + haversine_mi(west, east)), rel=1e-4)
    assert route.distance_mi == pytest.approx(trip["summary"]["length"] * kept_share)
    # Each hop of the synthetic trip takes a quarter of its time whatever its length, so the
    # cut is exactly the two spur hops' time, not a share proportional to distance.
    assert route.duration_s == pytest.approx(trip["summary"]["time"] / 2)
    assert route.cum_miles[-1] == pytest.approx(route.distance_mi)
    assert route.cum_seconds[-1] == pytest.approx(route.duration_s)
    assert len(route.points) == len(route.cum_miles) == len(route.cum_seconds)
    # The truck reaches the junction after the first hop; the spur adds nothing to that ETA.
    junction_at = route.points.index(junction)
    assert route.cum_seconds[junction_at] == pytest.approx(trip["summary"]["time"] / 4)
    assert route.cum_seconds[junction_at + 1] - route.cum_seconds[junction_at] < 60


def test_cumulative_time_follows_each_maneuver_speed():
    # 30 mi of interstate at 60 mph, then 10 mi of town streets at 20 mph.
    stops = [(41.0, -90.0), (41.0, -89.4), (41.0, -89.2)]
    points = densify(stops, per_leg=30)
    maneuvers = [
        {
            "street_names": ["I 80"],
            "length": 30.0,
            "time": 1800.0,
            "begin_shape_index": 0,
            "end_shape_index": 30,
        },
        {
            "street_names": ["Main St"],
            "length": 10.0,
            "time": 1800.0,
            "begin_shape_index": 30,
            "end_shape_index": 60,
        },
        {"length": 0.0, "time": 0.0, "begin_shape_index": 60, "end_shape_index": 60},
    ]
    trip = {
        "legs": [{"shape": encode_polyline(points), "maneuvers": maneuvers}],
        "summary": {"length": 40.0, "time": 3600.0},
    }
    route = routing._from_valhalla(trip)

    assert route.cum_seconds[30] == pytest.approx(1800.0)
    assert route.cum_seconds[15] == pytest.approx(900.0)
    assert route.cum_seconds[45] == pytest.approx(2700.0)
    assert route.cum_seconds[-1] == pytest.approx(3600.0)


def test_road_names_prefer_route_numbers():
    assert routing.road_name(["I 76 West", "Heartland Expressway"]) == "I-76"
    assert routing.road_name(["Heartland Expressway", "US 20"]) == "US-20"
    assert routing.road_name(["I 80 Expr"]) == "I-80"
    assert routing.road_name(["West Van Buren Street"]) == "West Van Buren Street"
    assert routing.road_name([]) is None


@pytest.mark.parametrize(
    ("street_names", "expected"),
    [
        (["South Interstate 45"], "I-45"),
        (["Interstate 45 North"], "I-45"),
        (["US Highway 287"], "US-287"),
        (["U.S. Route 66"], "US-66"),
        (["State Highway 249"], "SH-249"),
        (["North Roosevelt Boulevard", "US 1"], "US-1"),
        (["Interstate 45 North Frontage Road", "McKinney Street"], "McKinney Street"),
        (["Interstate 45 Frontage Road"], None),
        (["NW 5th Street"], "NW 5th Street"),
    ],
)
def test_road_names_normalise_spelled_routes_and_skip_frontage_roads(street_names, expected):
    assert routing.road_name(street_names) == expected


@respx.mock
def test_requests_one_truck_route(chicago_denver):
    route = respx.post(VALHALLA).mock(return_value=httpx.Response(200, json=chicago_denver))

    main = routing.fetch_route(CHICAGO, DENVER, 42000)

    assert route.call_count == 1
    assert main.via == ["I-88", "I-80", "I-76"]
    body = json.loads(route.calls.last.request.content)
    assert body["costing"] == "truck"
    # 42,000 lb of cargo on a 35,000 lb rig.
    assert body["costing_options"]["truck"]["weight"] == pytest.approx(34.93)
    assert "alternates" not in body
    assert [loc["type"] for loc in body["locations"]] == ["break", "break"]
    assert body["units"] == "miles"
    assert route.calls.last.request.headers["user-agent"] == settings.HTTP_USER_AGENT


@respx.mock
def test_empty_truck_still_weighs_the_rig(chicago_denver):
    route = respx.post(VALHALLA).mock(return_value=httpx.Response(200, json=chicago_denver))
    routing.fetch_route(CHICAGO, DENVER, 0)
    body = json.loads(route.calls.last.request.content)
    assert body["costing_options"]["truck"]["weight"] == pytest.approx(15.88)


def test_gross_weight_is_capped_at_the_federal_limit():
    assert routing.truck_weight_t(80_000) == routing.truck_weight_t(45_000) == pytest.approx(36.29)


@respx.mock
def test_identical_replan_is_served_from_cache(chicago_denver):
    route = respx.post(VALHALLA).mock(return_value=httpx.Response(200, json=chicago_denver))

    first = routing.fetch_route(CHICAGO, DENVER, 42000)
    second = routing.fetch_route(CHICAGO, DENVER, 42000)

    assert route.call_count == 1
    assert second.via == first.via
    assert second.cum_miles[-1] == pytest.approx(second.distance_mi)
    # A different weight can open or close roads, so it is a different trip.
    routing.fetch_route(CHICAGO, DENVER, 10000)
    assert route.call_count == 2


@respx.mock
def test_trip_beyond_the_span_limit_is_refused_without_a_request():
    route = respx.post(VALHALLA)
    origin, destination = (CHICAGO.lat, CHICAGO.lon), (LOS_ANGELES.lat, LOS_ANGELES.lon)
    assert haversine_mi(origin, destination) > routing.VALHALLA_MAX_CROW_MI

    with pytest.raises(ValidationProblem) as info:
        routing.fetch_route(CHICAGO, LOS_ANGELES, 42000)

    assert info.value.message == routing.TOO_FAR
    assert info.value.field == "destination"
    assert not route.called


@pytest.mark.parametrize("code", [442, 171])
@respx.mock
def test_no_truck_route_is_a_validation_problem(code):
    respx.post(VALHALLA).mock(
        return_value=httpx.Response(
            400, json={"error_code": code, "error": "No path could be found"}
        )
    )
    with pytest.raises(ValidationProblem) as info:
        routing.fetch_route(CHICAGO, DENVER, 1000)
    assert info.value.message == routing.NO_ROUTE
    assert info.value.field == "destination"


@pytest.mark.parametrize(
    "response",
    [
        httpx.Response(503),
        httpx.Response(200, json={"unexpected": True}),
        httpx.Response(200, json={"trip": {"legs": "?"}}),
    ],
)
@respx.mock
def test_router_failures_are_upstream_errors(response):
    respx.post(VALHALLA).mock(return_value=response)
    with pytest.raises(UpstreamError):
        routing.fetch_route(CHICAGO, DENVER, 1000)


@respx.mock
def test_unreachable_router_is_an_upstream_error():
    respx.post(VALHALLA).mock(side_effect=httpx.ConnectTimeout("timed out"))
    with pytest.raises(UpstreamError, match="unavailable"):
        routing.fetch_route(CHICAGO, DENVER, 1000)


def test_main_roads_are_the_longest_three_in_driving_order():
    lengths = {"I-88": 100.0, "Main St": 1.0, "I-80": 500.0, "I-76": 180.0}
    first_seen = {"I-88": 0, "Main St": 1, "I-80": 2, "I-76": 3}
    assert routing.main_roads(lengths, first_seen) == ["I-88", "I-80", "I-76"]


def test_main_roads_leave_out_street_names_and_ramps_when_a_route_number_is_known():
    # Dallas to Houston as Valhalla describes it: downtown streets, I-45 and its short ramps.
    maneuvers = [
        (["South Akard Street"], 0.2),
        (["I 45 South", "Julius Schepps Freeway"], 2.1),
        (["South Interstate 45"], 0.4),
        (["I 45 South"], 230.0),
        (["Interstate 45 North Frontage Road"], 0.5),
        (["US 75"], 0.3),
        (["McKinney Street"], 0.3),
    ]
    lengths: dict[str, float] = {}
    first_seen: dict[str, int] = {}
    for street_names, miles in maneuvers:
        name = routing.road_name(street_names)
        if name:
            lengths[name] = lengths.get(name, 0.0) + miles
            first_seen.setdefault(name, len(first_seen))

    assert routing.main_roads(lengths, first_seen) == ["I-45"]


def test_main_roads_fall_back_to_street_names_without_route_numbers():
    lengths = {"Duval Street": 0.8, "Truman Avenue": 1.2}
    first_seen = {"Duval Street": 0, "Truman Avenue": 1}
    assert routing.main_roads(lengths, first_seen) == ["Duval Street", "Truman Avenue"]


def test_main_route_past_the_budget_is_an_upstream_error(monkeypatch):
    async def stuck(client, stops, weight_t):
        await asyncio.sleep(5)

    monkeypatch.setattr(routing, "_valhalla", stuck)
    monkeypatch.setattr(routing, "ROUTING_BUDGET_S", 0.05)
    with pytest.raises(UpstreamError, match="took too long"):
        routing.fetch_route(CHICAGO, DENVER)
