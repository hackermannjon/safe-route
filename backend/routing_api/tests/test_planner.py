from dataclasses import replace

import pytest

from routing_api.services import planner, routing
from routing_api.services.geo import cumulative_miles
from routing_api.services.types import Place, RouteCandidate

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


@pytest.fixture(autouse=True)
def two_routes(monkeypatch):
    routes = [straight_route(41.0, 70), straight_route(40.0, 60)]
    monkeypatch.setattr(routing, "fetch_routes", lambda *a, **k: routes)
    return routes


def plan():
    return planner.plan_trip(ORIGIN, DESTINATION)


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
