"""Trip planning (routes -> checkpoints -> weather at each ETA) and the plan's response shape."""

from __future__ import annotations

import string
from datetime import UTC, datetime

from . import checkpoints, routing, weather
from .errors import ValidationProblem
from .geo import simplify, to_lonlat
from .types import Checkpoint, LatLon, Place, RouteCandidate, WeatherSample

MAX_ROUTES = 3
SIMPLIFY_TOLERANCE_DEG = 0.0005
MAX_GEOMETRY_POINTS = 1500
# US hours-of-service rules require a break after 8 hours of driving; ETAs here ignore stops.
CONTINUOUS_DRIVING_NOTICE_S = 8 * 3600


def plan_trip(
    origin: Place,
    destination: Place,
    departure: datetime,
    spacing_mi: int,
) -> dict:
    departure = to_utc(departure)
    candidates = routing.fetch_routes(origin, destination, max_routes=MAX_ROUTES)
    if not candidates:
        raise ValidationProblem(routing.NO_ROUTE, field="destination")
    candidates = sorted(candidates, key=lambda r: r.duration_s)[:MAX_ROUTES]
    stops = [checkpoints.build_checkpoints(r, spacing_mi, departure) for r in candidates]
    # One lookup for every route, so cells the routes share are fetched once.
    samples = iter(weather.fetch_for_points([(c.lat, c.lon, c.eta) for cps in stops for c in cps]))
    forecasts = [[next(samples) for _ in cps] for cps in stops]
    return {
        "departure": iso(departure),
        "spacing_mi": spacing_mi,
        "notices": _notices(candidates),
        "routes": [
            route_payload(route_id, route, route_stops, route_weather)
            for route_id, route, route_stops, route_weather in zip(
                string.ascii_uppercase, candidates, stops, forecasts, strict=False
            )
        ],
    }


def route_payload(
    route_id: str, route: RouteCandidate, stops: list[Checkpoint], forecast: list[WeatherSample]
) -> dict:
    tolerance = _tolerance_for(route.points)
    return {
        "id": route_id,
        "label": f"Route {route_id}",
        "via": route.via,
        "distance_mi": round(route.distance_mi, 1),
        "duration_s": round(route.duration_s),
        # The destination checkpoint carries the same rounding, so the two always agree.
        "arrival": iso(stops[-1].eta),
        "geometry": {
            "type": "LineString",
            "coordinates": to_lonlat(simplify(route.points, tolerance)),
        },
        "checkpoints": [_checkpoint_payload(c, w) for c, w in zip(stops, forecast, strict=True)],
    }


def _checkpoint_payload(c: Checkpoint, sample: WeatherSample) -> dict:
    return {
        "index": c.index,
        "mile": round(c.mile, 1),
        "lat": c.lat,
        "lon": c.lon,
        "eta": iso(c.eta),
        "weather": _weather_payload(sample),
    }


def _weather_payload(sample: WeatherSample) -> dict:
    return {
        "wind_mph": round(sample.wind_mph, 1),
        "gust_mph": round(sample.gust_mph, 1),
        # Three decimals, so a reading of 0.095 in/h is never shown as 0.1.
        "rain_in_h": round(sample.rain_in_h, 3),
        "snow_in_h": round(sample.snow_in_h, 3),
        "temp_f": None if sample.temp_f is None else round(sample.temp_f, 1),
        "weather_code": sample.weather_code,
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
    if max(c.duration_s for c in candidates) > CONTINUOUS_DRIVING_NOTICE_S:
        notices.append("ETAs assume continuous driving and do not include rest breaks.")
    return notices


def _tolerance_for(points: list[LatLon]) -> float:
    """Douglas-Peucker tolerance that keeps the line under the point budget; the map cannot
    show more detail."""
    tolerance = SIMPLIFY_TOLERANCE_DEG
    while len(simplify(points, tolerance)) > MAX_GEOMETRY_POINTS:
        tolerance *= 2
    return tolerance


def to_utc(at: datetime) -> datetime:
    return at.astimezone(UTC) if at.tzinfo else at.replace(tzinfo=UTC)


def iso(at: datetime) -> str:
    return at.astimezone(UTC).replace(microsecond=0).strftime("%Y-%m-%dT%H:%M:%SZ")
