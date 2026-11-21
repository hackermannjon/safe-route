from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Literal

LatLon = tuple[float, float]
RouteSource = Literal["valhalla", "osrm"]


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
    source: RouteSource = "valhalla"


@dataclass(frozen=True)
class Checkpoint:
    index: int
    mile: float
    lat: float
    lon: float
    eta: datetime


@dataclass(frozen=True)
class WeatherSample:
    wind_mph: float
    gust_mph: float
    rain_in_h: float
    snow_in_h: float
    temp_f: float | None = None
    weather_code: int | None = None
