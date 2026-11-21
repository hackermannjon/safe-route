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
from routing_api.services.types import Place, RouteCandidate

FIXTURE = Path(__file__).parent / "fixtures" / "valhalla_chicago_denver.json"
VALHALLA = f"{settings.VALHALLA_URL}/route"
OSRM = f"{settings.OSRM_URL}/route/v1/driving/"

CHICAGO = Place(41.878, -87.629, "Chicago, IL")
DENVER = Place(39.739, -104.990, "Denver, CO")
ST_LOUIS = Place(38.627, -90.199, "St. Louis, MO")
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


def stops_of_body(body):
    return [(loc["lat"], loc["lon"]) for loc in body["locations"]]


def stops_of(request):
    body = json.loads(request.content)
    return body, stops_of_body(body)


def test_parses_recorded_valhalla_response(chicago_denver):
    main = routing._from_valhalla(chicago_denver["trip"])
    summary = chicago_denver["trip"]["summary"]

    assert main.source == "valhalla"
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


def test_out_and_back_at_a_stitch_point_is_cut():
    # The stitch point snapped onto a side road 3 mi north of the interstate, so the first leg
    # drives up to it and the second drives straight back down before carrying on.
    west, junction, side_road, east = (
        (40.67, -99.6),
        (40.67, -99.03),
        (40.7135, -99.03),
        (40.67, -98.4),
    )
    first = synthetic_trip([west, junction, side_road])
    second = synthetic_trip([side_road, junction, east])
    trip = {
        "legs": first["legs"] + second["legs"],
        "summary": {
            key: first["summary"][key] + second["summary"][key] for key in ("length", "time")
        },
    }
    route = routing._from_valhalla(trip)

    assert max(lat for lat, _ in route.points) == pytest.approx(junction[0])
    raw_points = densify([west, junction, side_road]) + densify([side_road, junction, east])[1:]
    kept_share = cumulative_miles(route.points)[-1] / cumulative_miles(raw_points)[-1]
    spur_mi = 2 * haversine_mi(junction, side_road)
    assert kept_share == pytest.approx(1 - spur_mi / (spur_mi + haversine_mi(west, east)), rel=1e-4)
    assert route.distance_mi == pytest.approx(trip["summary"]["length"] * kept_share)
    # Each hop of the synthetic trips takes half its trip's time whatever its length, so the
    # cut is exactly the two spur hops' time, not a share proportional to distance.
    assert route.duration_s == pytest.approx(
        first["summary"]["time"] / 2 + second["summary"]["time"] / 2
    )
    assert route.cum_miles[-1] == pytest.approx(route.distance_mi)
    assert route.cum_seconds[-1] == pytest.approx(route.duration_s)
    assert len(route.points) == len(route.cum_miles) == len(route.cum_seconds)
    # The truck reaches the junction after the first hop; the spur adds nothing to that ETA.
    junction_at = route.points.index(junction)
    assert route.cum_seconds[junction_at] == pytest.approx(first["summary"]["time"] / 2)
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


def test_cumulative_time_runs_across_stitched_legs():
    # Two stitched requests: the second leg's maneuver indices restart at 0.
    a, b, c = (40.0, -100.0), (40.0, -99.0), (40.0, -98.0)
    first, second = synthetic_trip([a, b], mph=60.0), synthetic_trip([b, c], mph=30.0)
    trip = {
        "legs": first["legs"] + second["legs"],
        "summary": {
            key: first["summary"][key] + second["summary"][key] for key in ("length", "time")
        },
    }
    route = routing._from_valhalla(trip)

    joint = route.points.index(b)
    assert route.cum_seconds[joint] == pytest.approx(first["summary"]["time"])
    assert route.cum_seconds[-1] == pytest.approx(trip["summary"]["time"])


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
def test_returns_valhalla_routes_with_a_single_call_when_enough(chicago_denver):
    route = respx.post(VALHALLA).mock(return_value=httpx.Response(200, json=chicago_denver))

    routes = routing.fetch_routes(CHICAGO, DENVER, 42000, max_routes=2)

    assert route.call_count == 1
    assert [r.via[0] for r in routes] == ["I-88", "US-20"]
    assert routes[0].duration_s < routes[1].duration_s
    body = json.loads(route.calls.last.request.content)
    assert body["costing"] == "truck"
    # 42,000 lb of cargo on a 35,000 lb rig.
    assert body["costing_options"]["truck"]["weight"] == pytest.approx(34.93)
    assert body["alternates"] == 2
    assert body["units"] == "miles"
    assert route.calls.last.request.headers["user-agent"] == settings.HTTP_USER_AGENT


@respx.mock
def test_empty_truck_still_weighs_the_rig(chicago_denver):
    route = respx.post(VALHALLA).mock(return_value=httpx.Response(200, json=chicago_denver))
    routing.fetch_routes(CHICAGO, DENVER, 0, max_routes=1)
    body = json.loads(route.calls.last.request.content)
    assert body["costing_options"]["truck"]["weight"] == pytest.approx(15.88)


def test_gross_weight_is_capped_at_the_federal_limit():
    assert routing.truck_weight_t(80_000) == routing.truck_weight_t(45_000) == pytest.approx(36.29)


@respx.mock
def test_identical_replan_is_served_from_cache(chicago_denver):
    route = respx.post(VALHALLA).mock(return_value=httpx.Response(200, json=chicago_denver))

    first = routing.fetch_routes(CHICAGO, DENVER, 42000, max_routes=2)
    second = routing.fetch_routes(CHICAGO, DENVER, 42000, max_routes=2)

    assert route.call_count == 1
    assert [r.via for r in second] == [r.via for r in first]
    assert all(r.cum_miles[-1] == pytest.approx(r.distance_mi) for r in second)
    # A different weight can open or close roads, so it is a different trip.
    routing.fetch_routes(CHICAGO, DENVER, 10000, max_routes=2)
    assert route.call_count == 2


@respx.mock
def test_long_trip_is_split_under_the_span_limit():
    origin, destination = (CHICAGO.lat, CHICAGO.lon), (LOS_ANGELES.lat, LOS_ANGELES.lon)
    crow = haversine_mi(origin, destination)
    assert crow > routing.VALHALLA_MAX_CROW_MI
    seen = []

    def handler(request):
        body, stops = stops_of(request)
        seen.append(body)
        # Every request the public instance sees stays within its limit.
        assert routing._crow_miles(stops) <= routing.VALHALLA_MAX_CROW_MI
        return httpx.Response(200, json={"trip": synthetic_trip(stops)})

    respx.post(VALHALLA).mock(side_effect=handler)

    routes = routing.fetch_routes(CHICAGO, LOS_ANGELES, 42000)

    # The main route is two plain requests that meet at a waypoint halfway along the great circle.
    first_half, second_half = seen[0], seen[1]
    bridge = first_half["locations"][-1]
    assert stops_of_body(first_half)[0] == origin
    assert stops_of_body(second_half) == [(bridge["lat"], bridge["lon"]), destination]
    assert bridge["search_filter"] == routing.BRIDGE_FILTER
    assert "search_filter" not in first_half["locations"][0]
    assert haversine_mi(origin, (bridge["lat"], bridge["lon"])) == pytest.approx(crow / 2)
    assert all("alternates" not in b for b in seen)
    # Valhalla offers no alternates here, so the detours supply the other routes.
    assert len(routes) == 3
    assert all(r.source == "valhalla" for r in routes)
    main = routes[0]
    assert main.points[0] == pytest.approx(origin, abs=1e-5)
    assert main.points[-1] == pytest.approx(destination, abs=1e-5)
    assert main.cum_miles[-1] == pytest.approx(main.distance_mi)


def test_bridge_spaces_waypoints_evenly():
    a, b = (40.0, -75.0), (34.0, -118.0)
    path, added = routing._bridge([a, b])
    hops = [haversine_mi(p, q) for p, q in zip(path, path[1:], strict=False)]
    assert len(path) == 2 + len(added) and len(added) >= 2
    assert max(hops) <= routing.VALHALLA_MAX_CROW_MI
    assert max(hops) - min(hops) < 0.5
    assert routing._bridge([a, (40.5, -76.0)]) == ([a, (40.5, -76.0)], frozenset())


@respx.mock
def test_synthesizes_a_third_route_by_splitting_long_detours(chicago_denver):
    origin, destination = (CHICAGO.lat, CHICAGO.lon), (DENVER.lat, DENVER.lon)

    def handler(request):
        body, stops = stops_of(request)
        if stops == [origin, destination]:
            return httpx.Response(200, json=chicago_denver)
        # Chicago-Denver plus an offset is beyond the public instance's span limit, so each
        # detour must arrive as two plain A-to-B requests without alternates.
        assert len(stops) == 2
        assert "alternates" not in body
        return httpx.Response(200, json={"trip": synthetic_trip(stops)})

    route = respx.post(VALHALLA).mock(side_effect=handler)

    routes = routing.fetch_routes(CHICAGO, DENVER, 42000)

    assert len(routes) == 3
    assert route.call_count == 1 + 4 * 2
    assert [r.duration_s for r in routes] == sorted(r.duration_s for r in routes)
    detour = next(r for r in routes if r.via == ["I-70"])
    assert detour.cum_miles[-1] == pytest.approx(detour.distance_mi)
    assert detour.duration_s <= routes[0].duration_s * routing.MAX_DURATION_RATIO


@respx.mock
def test_short_trip_detours_use_a_through_location():
    origin, destination = (CHICAGO.lat, CHICAGO.lon), (ST_LOUIS.lat, ST_LOUIS.lon)
    seen = []

    def handler(request):
        body, stops = stops_of(request)
        seen.append(body)
        if len(stops) == 2:
            return httpx.Response(200, json={"trip": synthetic_trip(stops, road="I 55")})
        return httpx.Response(200, json={"trip": synthetic_trip(stops, mph=55.0)})

    respx.post(VALHALLA).mock(side_effect=handler)

    routes = routing.fetch_routes(CHICAGO, ST_LOUIS, 30000)

    assert len(routes) == 3
    assert routes[0].via == ["I-55"]
    detours = [b for b in seen if len(b["locations"]) == 3]
    assert len(detours) == 4
    assert all(
        [loc["type"] for loc in b["locations"]] == ["break", "through", "break"] for b in detours
    )
    assert {tuple(stops_of_body(b)[::2]) for b in detours} == {(origin, destination)}


@respx.mock
def test_failed_detours_are_dropped_not_fatal():
    def handler(request):
        _, stops = stops_of(request)
        if len(stops) == 2:
            return httpx.Response(200, json={"trip": synthetic_trip(stops)})
        return httpx.Response(429, json={"error": "slow down"})

    respx.post(VALHALLA).mock(side_effect=handler)
    respx.get(url__startswith=OSRM).mock(return_value=httpx.Response(502, text="bad gateway"))

    routes = routing.fetch_routes(CHICAGO, ST_LOUIS, 30000)
    assert len(routes) == 1

    # Rate-limited detours may succeed next time, so the trimmed result is not remembered.
    calls = respx.calls.call_count
    routing.fetch_routes(CHICAGO, ST_LOUIS, 30000)
    assert respx.calls.call_count > calls


@respx.mock
def test_failed_truck_detours_are_replaced_by_osrm_alternatives():
    origin, destination = (CHICAGO.lat, CHICAGO.lon), (ST_LOUIS.lat, ST_LOUIS.lon)

    def handler(request):
        _, stops = stops_of(request)
        if len(stops) == 2:
            return httpx.Response(200, json={"trip": synthetic_trip(stops, road="I 55")})
        return httpx.Response(429, json={"error": "slow down"})

    respx.post(VALHALLA).mock(side_effect=handler)
    west = osrm_route([origin, (40.3, -90.6), destination], summary="US 67", seconds=20_000.0)
    east = osrm_route([origin, (40.0, -88.2), destination], summary="I 57", seconds=21_000.0)
    osrm = respx.get(url__startswith=OSRM).mock(
        return_value=httpx.Response(200, json={"code": "Ok", "routes": [west, east]})
    )

    routes = routing.fetch_routes(CHICAGO, ST_LOUIS, 30000)

    assert [r.source for r in routes] == ["valhalla", "osrm", "osrm"]
    assert [r.via for r in routes] == [["I-55"], ["US-67"], ["I-57"]]
    assert osrm.calls[0].request.url.params["alternatives"] == "3"


@respx.mock
def test_detours_that_found_nothing_distinct_are_not_padded_with_osrm():
    respx.post(VALHALLA).mock(
        side_effect=lambda request: httpx.Response(
            # Every detour comes back on the main road, so nothing distinct is added.
            200,
            json={"trip": synthetic_trip([stops_of(request)[1][0], stops_of(request)[1][-1]])},
        )
    )
    osrm = respx.get(url__startswith=OSRM)

    routes = routing.fetch_routes(CHICAGO, ST_LOUIS, 30000)

    assert len(routes) == 1
    assert not osrm.called


@respx.mock
def test_detours_past_the_budget_are_dropped(monkeypatch):
    async def slow_detours(*args):
        await asyncio.sleep(5)

    main_calls = []

    async def fast_main(client, stops, weight_t):
        if len(stops) == 2:
            main_calls.append(stops)
            return [routing._from_valhalla(synthetic_trip(stops))]
        return await slow_detours()

    monkeypatch.setattr(routing, "_valhalla", fast_main)
    monkeypatch.setattr(routing, "ROUTING_BUDGET_S", 0.1)

    assert len(routing.fetch_routes(CHICAGO, ST_LOUIS, 30000)) == 1
    routing.fetch_routes(CHICAGO, ST_LOUIS, 30000)
    assert len(main_calls) == 2  # the trimmed result was not cached


def make_candidate(points, mph=60.0):
    cum = cumulative_miles(points)
    return RouteCandidate(
        points=points,
        cum_miles=cum,
        cum_seconds=[m / mph * 3600 for m in cum],
        distance_mi=cum[-1],
        duration_s=cum[-1] / mph * 3600,
    )


def test_select_distinct_drops_overlapping_and_slow_candidates():
    stops = [(41.0, -90.0), (41.0, -88.0)]
    main = make_candidate(densify(stops))
    # Same road with sub-cell GPS noise: a duplicate, not an alternative.
    twin = make_candidate([(lat + 0.0005, lon) for lat, lon in densify(stops)])
    north = make_candidate(densify([stops[0], (41.4, -89.0), stops[1]]))
    crawl = make_candidate(densify([stops[0], (41.0 - 0.4, -89.0), stops[1]]), mph=30.0)

    kept = routing.select_distinct([main, twin, crawl, north], 3)

    assert kept == [main, north]


def test_select_distinct_respects_limit():
    stops = [(41.0, -90.0), (41.0, -88.0)]
    routes = [
        make_candidate(densify([stops[0], (41.0 + d, -89.0), stops[1]])) for d in (0, 0.3, -0.3)
    ]
    assert routing.select_distinct(routes, 2) == routes[:2]
    assert routing.select_distinct([], 3) == []


def test_via_points_sit_on_both_sides_at_thirds(chicago_denver):
    main = routing._from_valhalla(chicago_denver["trip"])
    origin, destination = (CHICAGO.lat, CHICAGO.lon), (DENVER.lat, DENVER.lon)
    expected_offset = haversine_mi(origin, destination) * routing.VIA_OFFSET_RATIO

    vias = routing.via_points(main, origin, destination)

    assert len(vias) == 4
    # The route runs roughly west, so the two sides split north and south of it.
    first_third, second_third = vias[:2], vias[2:]
    for pair in (first_third, second_third):
        north, south = sorted(pair, key=lambda p: -p[0])
        assert north[0] > south[0] + 2 * expected_offset / 69.1 * 0.8
        assert haversine_mi(north, south) == pytest.approx(2 * expected_offset, rel=0.1)
    assert max(p[1] for p in first_third) > min(p[1] for p in second_third)


def osrm_route(stops, summary="I 80, I 76", seconds=600.0, durations=None):
    points = densify(stops, per_leg=10)
    meters = cumulative_miles(points)[-1] * 1609.344
    per_segment = durations or [seconds / (len(points) - 1)] * (len(points) - 1)
    return {
        "geometry": {"type": "LineString", "coordinates": [[lon, lat] for lat, lon in points]},
        "legs": [{"summary": summary, "distance": meters, "annotation": {"duration": per_segment}}],
        "distance": meters,
        "duration": seconds,
    }


@respx.mock
def test_falls_back_to_osrm_when_valhalla_fails():
    origin, destination = (CHICAGO.lat, CHICAGO.lon), (ST_LOUIS.lat, ST_LOUIS.lon)
    valhalla = respx.post(VALHALLA).mock(return_value=httpx.Response(503))
    main = {"code": "Ok", "routes": [osrm_route([origin, destination])]}

    def handler(request):
        # Detours through a via point fail, leaving the single fallback route.
        if request.url.params["alternatives"] == "3":
            return httpx.Response(200, json=main)
        return httpx.Response(500)

    osrm = respx.get(url__startswith=OSRM).mock(side_effect=handler)

    routes = routing.fetch_routes(CHICAGO, ST_LOUIS, 30000)

    assert len(routes) == 1
    route = routes[0]
    assert route.source == "osrm"
    assert route.via == ["I-80", "I-76"]
    assert route.duration_s == 600.0
    assert route.cum_miles[5] == pytest.approx(route.distance_mi / 2, rel=1e-2)
    assert route.cum_seconds[-1] == pytest.approx(600.0)
    first = osrm.calls[0].request
    assert first.url.params["overview"] == "full"
    assert first.url.params["geometries"] == "geojson"
    assert first.url.params["annotations"] == "duration"
    assert first.url.params["steps"] == "true"
    assert f"{CHICAGO.lon:.6f},{CHICAGO.lat:.6f};" in first.url.path

    # A fallback caused by an outage is not cached, so the next plan tries Valhalla again.
    routing.fetch_routes(CHICAGO, ST_LOUIS, 30000)
    assert valhalla.call_count == 2


@respx.mock
def test_no_route_anywhere_is_a_validation_problem():
    respx.post(VALHALLA).mock(
        return_value=httpx.Response(
            400, json={"error_code": 442, "error": "No path could be found"}
        )
    )
    respx.get(url__startswith=OSRM).mock(
        return_value=httpx.Response(400, json={"code": "NoRoute", "message": "Impossible route"})
    )
    with pytest.raises(ValidationProblem) as info:
        routing.fetch_routes(CHICAGO, DENVER, 1000)
    assert info.value.field == "destination"


@respx.mock
def test_router_answering_ok_with_no_routes_is_a_validation_problem():
    respx.post(VALHALLA).mock(return_value=httpx.Response(503))
    respx.get(url__startswith=OSRM).mock(
        return_value=httpx.Response(200, json={"code": "Ok", "routes": []})
    )
    with pytest.raises(ValidationProblem) as info:
        routing.fetch_routes(CHICAGO, DENVER, 1000)
    assert info.value.field == "destination"


@respx.mock
def test_both_routers_down_is_an_upstream_error():
    respx.post(VALHALLA).mock(side_effect=httpx.ConnectTimeout("timed out"))
    respx.get(url__startswith=OSRM).mock(return_value=httpx.Response(502, text="bad gateway"))
    with pytest.raises(UpstreamError):
        routing.fetch_routes(CHICAGO, DENVER, 1000)


@respx.mock
def test_malformed_valhalla_payload_falls_back():
    origin, destination = (CHICAGO.lat, CHICAGO.lon), (ST_LOUIS.lat, ST_LOUIS.lon)
    respx.post(VALHALLA).mock(return_value=httpx.Response(200, json={"trip": {"legs": "?"}}))
    respx.get(url__startswith=OSRM).mock(
        return_value=httpx.Response(
            200, json={"code": "Ok", "routes": [osrm_route([origin, destination])]}
        )
    )
    routes = routing.fetch_routes(CHICAGO, ST_LOUIS, 1000, max_routes=1)
    assert routes[0].source == "osrm"


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
        routing.fetch_routes(CHICAGO, DENVER)


@respx.mock
def test_coast_to_coast_detours_are_stitched_too():
    new_york, los_angeles = (40.713, -74.006), (LOS_ANGELES.lat, LOS_ANGELES.lon)
    seen = []

    def handler(request):
        _, stops = stops_of(request)
        seen.append(stops)
        assert len(stops) == 2
        assert routing._crow_miles(stops) <= routing.VALHALLA_MAX_CROW_MI
        return httpx.Response(200, json={"trip": synthetic_trip(stops)})

    respx.post(VALHALLA).mock(side_effect=handler)

    routes = routing.fetch_routes(Place(*new_york), LOS_ANGELES)

    assert len(routes) == 3
    for route in routes:
        assert route.points[0] == pytest.approx(new_york, abs=1e-5)
        assert route.points[-1] == pytest.approx(los_angeles, abs=1e-5)
    # 2,450 mi straight-line needs three hops for the main route.
    assert len([s for s in seen if s[0] == new_york]) >= 5


@respx.mock
def test_slow_valhalla_falls_back_to_osrm_inside_the_budget(monkeypatch):
    origin, destination = (CHICAGO.lat, CHICAGO.lon), (DENVER.lat, DENVER.lon)

    async def stuck(client, stops, weight_t):
        await asyncio.sleep(5)

    monkeypatch.setattr(routing, "_valhalla", stuck)
    monkeypatch.setattr(routing, "VALHALLA_MAIN_BUDGET_S", 0.05)
    main = {"code": "Ok", "routes": [osrm_route([origin, destination])]}
    respx.get(url__startswith=OSRM).mock(return_value=httpx.Response(200, json=main))

    routes = routing.fetch_routes(CHICAGO, DENVER)

    assert routes and all(r.source == "osrm" for r in routes)


def test_osrm_road_names_come_from_steps_weighted_by_length():
    stops = [(34.2257, -77.9447), (35.7796, -78.6382)]
    route = osrm_route(stops, summary="")
    route["legs"][0]["steps"] = [
        {"name": "South 3rd Street", "ref": "US 17 Business", "distance": 2_700.0},
        {"name": "Michael Jordan Highway", "ref": "I 40; US 117; NC 132", "distance": 172_000.0},
        {"name": "", "ref": "I 40", "distance": 20_000.0},
        {"name": "Rock Quarry Road", "distance": 1_300.0},
        {"name": "", "distance": 500.0},
    ]
    # Valhalla's rule applies: a route number wins over the street name, then the longest roads.
    assert routing._from_osrm(route).via == ["I-40"]


def test_osrm_leg_without_steps_falls_back_to_its_summary():
    route = osrm_route([(41.88, -87.63), (39.74, -104.99)], summary="I 80, I 76")
    assert "steps" not in route["legs"][0]
    assert routing._from_osrm(route).via == ["I-80", "I-76"]


def test_osrm_times_come_from_its_per_segment_annotations():
    # The first half is twice as slow as the second.
    stops = [(CHICAGO.lat, CHICAGO.lon), (ST_LOUIS.lat, ST_LOUIS.lon)]
    durations = [80.0] * 5 + [40.0] * 5
    route = routing._from_osrm(osrm_route(stops, seconds=600.0, durations=durations))
    assert route.cum_seconds[5] == pytest.approx(400.0)
    assert route.cum_seconds[-1] == pytest.approx(600.0)
