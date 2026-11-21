"""Trip planning and the plan's response shape."""

from __future__ import annotations

from . import routing
from .geo import simplify, to_lonlat
from .types import LatLon, Place, RouteCandidate

SIMPLIFY_TOLERANCE_DEG = 0.0005
MAX_GEOMETRY_POINTS = 1500


def plan_trip(origin: Place, destination: Place) -> dict:
    return {"routes": [route_payload("A", routing.fetch_route(origin, destination))]}


def route_payload(route_id: str, route: RouteCandidate) -> dict:
    tolerance = _tolerance_for(route.points)
    return {
        "id": route_id,
        "label": f"Route {route_id}",
        "via": route.via,
        "distance_mi": round(route.distance_mi, 1),
        "duration_s": round(route.duration_s),
        "geometry": {
            "type": "LineString",
            "coordinates": to_lonlat(simplify(route.points, tolerance)),
        },
    }


def _tolerance_for(points: list[LatLon]) -> float:
    """Douglas-Peucker tolerance that keeps the line under the point budget; the map cannot
    show more detail."""
    tolerance = SIMPLIFY_TOLERANCE_DEG
    while len(simplify(points, tolerance)) > MAX_GEOMETRY_POINTS:
        tolerance *= 2
    return tolerance
