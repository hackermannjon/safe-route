"""Trip planning (routes -> checkpoints -> weather at ETA -> risk -> ranking) and the plan
response shape."""

from __future__ import annotations

import string
from bisect import bisect_left, bisect_right
from dataclasses import dataclass
from datetime import UTC, datetime

from . import checkpoints, routing, weather
from .errors import ValidationProblem
from .geo import interpolate_along, simplify, to_lonlat
from .recommend import Ranking, RouteScore, rank_routes
from .risk import assess
from .types import (
    Checkpoint,
    LatLon,
    Place,
    RiskAssessment,
    RiskLevel,
    RouteCandidate,
    WeatherSample,
)

MAX_ROUTES = 3
SIMPLIFY_TOLERANCE_DEG = 0.0005
MAX_GEOMETRY_POINTS = 1500
# US hours-of-service rules require a break after 8 hours of driving; ETAs here ignore stops.
CONTINUOUS_DRIVING_NOTICE_S = 8 * 3600


@dataclass(frozen=True)
class AssessedCheckpoint:
    checkpoint: Checkpoint
    weather: WeatherSample
    risk: RiskAssessment


@dataclass(frozen=True)
class Span:
    """A stretch of road with a single risk level, in route miles."""

    level: RiskLevel
    from_mi: float
    to_mi: float


def plan_trip(
    origin: Place,
    destination: Place,
    departure: datetime,
    spacing_mi: int,
    cargo_lb: float = 0,
) -> dict:
    departure = to_utc(departure)
    candidates = routing.fetch_routes(origin, destination, cargo_lb, max_routes=MAX_ROUTES)
    if not candidates:
        raise ValidationProblem(routing.NO_ROUTE, field="destination")
    candidates = sorted(candidates, key=lambda r: r.duration_s)[:MAX_ROUTES]
    stops = [checkpoints.build_checkpoints(r, spacing_mi, departure) for r in candidates]
    # One lookup for every route, so cells the routes share are fetched once.
    samples = weather.fetch_for_points([(c.lat, c.lon, c.eta) for cps in stops for c in cps])
    assessed: list[list[AssessedCheckpoint]] = []
    offset = 0
    for cps in stops:
        chunk = samples[offset : offset + len(cps)]
        offset += len(cps)
        assessed.append(
            [AssessedCheckpoint(c, w, assess(w, cargo_lb)) for c, w in zip(cps, chunk, strict=True)]
        )
    spans = [merge_spans(points) for points in assessed]
    # Ids stay in fastest-first order: they name routes, the rank orders them.
    ids = string.ascii_uppercase[: len(candidates)]
    rankings = {
        r.route_id: r
        for r in rank_routes(
            [score_route(i, route, s) for i, route, s in zip(ids, candidates, spans, strict=True)]
        )
    }
    recommended = next(r.route_id for r in rankings.values() if r.recommended)
    return {
        "departure": iso(departure),
        "cargo_lb": cargo_lb,
        "spacing_mi": spacing_mi,
        "recommended_route_id": recommended,
        "notices": _notices(candidates, spans),
        "routes": [
            route_payload(route_id, route, points, route_spans, rankings[route_id])
            for route_id, route, points, route_spans in zip(
                ids, candidates, assessed, spans, strict=True
            )
        ],
    }


def score_route(route_id: str, route: RouteCandidate, spans: list[Span]) -> RouteScore:
    return RouteScore(
        route_id=route_id,
        label=f"Route {route_id}",
        miles=miles_by_level(spans),
        avg_risk=average_risk(spans),
        duration_s=route.duration_s,
    )


def merge_spans(points: list[AssessedCheckpoint]) -> list[Span]:
    """Level each stretch between checkpoints by its worse end, then merge equal neighbours.

    Weather between two checkpoints is unknown, so a stretch is never reported as calmer than
    either end of it.
    """
    spans: list[Span] = []
    for a, b in zip(points, points[1:], strict=False):
        level = max(a.risk.level, b.risk.level)
        if spans and spans[-1].level == level:
            spans[-1] = Span(level, spans[-1].from_mi, b.checkpoint.mile)
        else:
            spans.append(Span(level, a.checkpoint.mile, b.checkpoint.mile))
    return spans


def miles_by_level(spans: list[Span]) -> dict[RiskLevel, float]:
    miles = dict.fromkeys(RiskLevel, 0.0)
    for span in spans:
        miles[span.level] += span.to_mi - span.from_mi
    return miles


def average_risk(spans: list[Span]) -> float:
    """Mileage-weighted mean of the numeric level (LOW=0 .. NO_TRAVEL=4)."""
    total = sum(s.to_mi - s.from_mi for s in spans)
    if total <= 0:
        return 0.0
    return sum(int(s.level) * (s.to_mi - s.from_mi) for s in spans) / total


def route_payload(
    route_id: str,
    route: RouteCandidate,
    points: list[AssessedCheckpoint],
    spans: list[Span],
    ranking: Ranking,
) -> dict:
    tolerance = _tolerance_for(route.points)
    return {
        "id": route_id,
        "label": f"Route {route_id}",
        "rank": ranking.rank,
        "recommended": ranking.recommended,
        "rank_reason": ranking.reason,
        "via": route.via,
        "distance_mi": round(route.distance_mi, 1),
        "duration_s": round(route.duration_s),
        # The destination checkpoint carries the same rounding, so the two always agree.
        "arrival": iso(points[-1].checkpoint.eta),
        "risk": {
            "worst_level": max(p.risk.level for p in points).name,
            "avg_risk": round(average_risk(spans), 2),
            "miles": {level.name: round(m, 1) for level, m in miles_by_level(spans).items()},
        },
        "geometry": {
            "type": "LineString",
            "coordinates": to_lonlat(simplify(route.points, tolerance)),
        },
        "segments": {
            "type": "FeatureCollection",
            "features": [_segment_feature(route, span, tolerance) for span in spans],
        },
        "checkpoints": [_checkpoint_payload(p) for p in points],
    }


def _segment_feature(route: RouteCandidate, span: Span, tolerance: float) -> dict:
    line = slice_line(route.points, route.cum_miles, span.from_mi, span.to_mi)
    return {
        "type": "Feature",
        "properties": {
            "level": span.level.name,
            "from_mi": round(span.from_mi, 1),
            "to_mi": round(span.to_mi, 1),
        },
        "geometry": {"type": "LineString", "coordinates": to_lonlat(simplify(line, tolerance))},
    }


def slice_line(
    points: list[LatLon], cum_miles: list[float], start_mi: float, end_mi: float
) -> list[LatLon]:
    """The part of a polyline between two route miles, with interpolated ends."""
    inner = points[bisect_right(cum_miles, start_mi) : bisect_left(cum_miles, end_mi)]
    return [
        interpolate_along(points, cum_miles, start_mi),
        *inner,
        interpolate_along(points, cum_miles, end_mi),
    ]


def _checkpoint_payload(point: AssessedCheckpoint) -> dict:
    c, risk = point.checkpoint, point.risk
    return {
        "index": c.index,
        "mile": round(c.mile, 1),
        "lat": c.lat,
        "lon": c.lon,
        "eta": iso(c.eta),
        "level": risk.level.name,
        "factor": risk.factor,
        "load_rule": risk.load_rule,
        "weather": _weather_payload(point.weather),
    }


def _weather_payload(sample: WeatherSample) -> dict:
    return {
        "wind_mph": round(sample.wind_mph, 1),
        "gust_mph": round(sample.gust_mph, 1),
        # Three decimals: rain thresholds sit at tenths of an inch, so 0.095 must not read as 0.1.
        "rain_in_h": round(sample.rain_in_h, 3),
        "snow_in_h": round(sample.snow_in_h, 3),
        "temp_f": None if sample.temp_f is None else round(sample.temp_f, 1),
        "weather_code": sample.weather_code,
    }


def _notices(candidates: list[RouteCandidate], spans: list[list[Span]]) -> list[str]:
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
    if all(round(miles_by_level(s)[RiskLevel.NO_TRAVEL], 1) > 0 for s in spans):
        notices.append(
            "Every route crosses No Travel conditions at this departure time. "
            "Consider a later departure."
        )
    return notices


def _tolerance_for(points: list[LatLon]) -> float:
    """Douglas-Peucker tolerance that keeps the line under the point budget; the map cannot
    show more detail, and segments reuse it so they lie exactly on the route line."""
    tolerance = SIMPLIFY_TOLERANCE_DEG
    while len(simplify(points, tolerance)) > MAX_GEOMETRY_POINTS:
        tolerance *= 2
    return tolerance


def to_utc(at: datetime) -> datetime:
    return at.astimezone(UTC) if at.tzinfo else at.replace(tzinfo=UTC)


def iso(at: datetime) -> str:
    return at.astimezone(UTC).replace(microsecond=0).strftime("%Y-%m-%dT%H:%M:%SZ")
