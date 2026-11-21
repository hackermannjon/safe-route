from __future__ import annotations

from dataclasses import dataclass, field

LatLon = tuple[float, float]


@dataclass(frozen=True)
class Place:
    lat: float
    lon: float
    label: str = ""


@dataclass
class RouteCandidate:
    """A drivable route with the cumulative distance and time at every shape point."""

    points: list[LatLon]
    cum_miles: list[float]
    cum_seconds: list[float]
    distance_mi: float
    duration_s: float
    via: list[str] = field(default_factory=list)
