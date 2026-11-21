"""Trip planning and the plan's response shape."""

from __future__ import annotations

import string

from . import routing
from .errors import ValidationProblem
from .geo import simplify, to_lonlat
from .types import LatLon, Place, RouteCandidate

MAX_ROUTES = 3
SIMPLIFY_TOLERANCE_DEG = 0.0005
MAX_GEOMETRY_POINTS = 1500


def plan_trip(origin: Place, destination: Place) -> dict:
    candidates = routing.fetch_routes(origin, destination, max_routes=MAX_ROUTES)
    if not candidates:
        raise ValidationProblem(routing.NO_ROUTE, field="destination")
    candidates = sorted(candidates, key=lambda r: r.duration_s)[:MAX_ROUTES]
    return {
        "notices": _notices(candidates),
        "routes": [
            route_payload(route_id, route)
            for route_id, route in zip(string.ascii_uppercase, candidates, strict=False)
        ],
    }


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


def _notices(candidates: list[RouteCandidate]) -> list[str]:
    notices = []
    if len(candidates) == 1:
        notices.append("Only one route was available for this trip.")
    elif len(candidates) < MAX_ROUTES:
        notices.append(f"Only {len(candidates)} distinct routes were available for this trip.")
    fallback = [
        f"Route {string.ascii_uppercase[i]}" for i, c in enumerate(candidates) if c.source == "osrm"
    ]
    if len(fallback) == len(candidates):
        notices.append(
            "Truck routing was unavailable, so routes come from a general road router "
            "and may not respect truck restrictions."
        )
    elif fallback:
        names = " and ".join(fallback)
        verb = "comes" if len(fallback) == 1 else "come"
        notices.append(
            f"{names} {verb} from a general road router because truck routing could not finish, "
            "and may not respect truck restrictions."
        )
    return notices


def _tolerance_for(points: list[LatLon]) -> float:
    """Douglas-Peucker tolerance that keeps the line under the point budget; the map cannot
    show more detail."""
    tolerance = SIMPLIFY_TOLERANCE_DEG
    while len(simplify(points, tolerance)) > MAX_GEOMETRY_POINTS:
        tolerance *= 2
    return tolerance
