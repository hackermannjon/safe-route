"""Weather and risk over the trip corridor for every hour of the two days after departure.

The corridor is every grid cell whose centre lies within BUFFER_MI of a planned route. The grid
is the finest that keeps the corridor within MAX_CELLS locations: Open-Meteo meters locations,
not hours, so all 49 hours of a cell cost one location, and a plan made in the same minute
needs its own share of the ~600 a minute allowance. Cell centres are multiples of 0.1 degree,
so the forecast cache is shared with plans.

Every value is classified here with the same rules as checkpoints; the client only draws.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta
from itertools import pairwise

from . import weather
from .geo import haversine_mi
from .planner import iso, to_utc
from .risk import assess
from .types import LatLon

BUFFER_MI = 40.0
MAX_CELLS = 250
# The slider runs from departure to 48 h after it, in whole hours.
HOURS = 49
# Corridor membership is decided from points this far apart along each route. Against a
# 40 mile buffer that blurs the edge by well under a mile.
SAMPLE_MI = 10.0
MAX_STEP_TENTHS = 20
MI_PER_DEG_LAT = 69.09

# Integers on the wire; a value is `int * scale`. Readings are truncated, as on checkpoints, so
# a value just under a threshold never reads as the threshold itself.
METRICS = {
    "risk": 1,
    "wind_mph": 1,
    "rain_in_h": 0.01,
    "snow_in_h": 0.01,
}


@dataclass(frozen=True)
class Grid:
    """Cell (row, col) is centred on (lat0 + row * dlat, lon0 + col * dlon); rows run north."""

    lat0: float
    lon0: float
    dlat: float
    dlon: float
    rows: int
    cols: int
    # Row-major indices of the cells inside the corridor, ascending.
    cells: tuple[int, ...]

    def center(self, index: int) -> tuple[float, float]:
        row, col = divmod(index, self.cols)
        # Adding 0.0 folds -0.0 into 0.0, the spelling the forecast cache uses.
        return (
            round(self.lat0 + row * self.dlat, 1) + 0.0,
            round(self.lon0 + col * self.dlon, 1) + 0.0,
        )


def corridor_heatmap(
    routes: Sequence[Sequence[LatLon]], departure: datetime, cargo_lb: float
) -> dict:
    grid = build_grid(routes)
    start = weather.nearest_hour(to_utc(departure))
    hours = [start + timedelta(hours=h) for h in range(HOURS)]
    cells = [grid.center(i) for i in grid.cells]
    table = weather.fetch_cells(cells, hours)

    frames: dict[str, list[list[int]]] = {name: [] for name in METRICS}
    for hour in hours:
        samples = [table[(cell, hour)] for cell in cells]
        frames["risk"].append([int(assess(s, cargo_lb).level) for s in samples])
        frames["wind_mph"].append([math.floor(s.wind_mph) for s in samples])
        frames["rain_in_h"].append([_hundredths(s.rain_in_h) for s in samples])
        frames["snow_in_h"].append([_hundredths(s.snow_in_h) for s in samples])

    return {
        "departure": iso(to_utc(departure)),
        "cargo_lb": cargo_lb,
        "grid": {
            "lat0": grid.lat0,
            "lon0": grid.lon0,
            "dlat": grid.dlat,
            "dlon": grid.dlon,
            "rows": grid.rows,
            "cols": grid.cols,
        },
        "cells": list(grid.cells),
        "hours": [iso(h) for h in hours],
        "values": {
            name: {"scale": scale, "frames": frames[name]} for name, scale in METRICS.items()
        },
    }


def _hundredths(value: float) -> int:
    # The epsilon keeps 0.29 * 100 (28.999999999999996) from truncating to 28.
    return max(0, math.floor(value * 100 + 1e-9))


def build_grid(routes: Sequence[Sequence[LatLon]]) -> Grid:
    """The finest corridor grid within MAX_CELLS.

    The search starts from the cell size one route's corridor alone would need, a lower bound:
    alternatives only add area, so no finer grid can fit.
    """
    samples = corridor_samples(routes)
    longest = max(_length(line) for line in routes)
    area = longest * 2 * BUFFER_MI + math.pi * BUFFER_MI**2
    tenth_mi = MI_PER_DEG_LAT / 10
    start = max(1, math.floor(math.sqrt(area / MAX_CELLS) / tenth_mi) - 1)
    grid = _grid(samples, start)
    for tenths in range(start + 1, MAX_STEP_TENTHS + 1):
        if len(grid.cells) <= MAX_CELLS:
            break
        grid = _grid(samples, tenths)
    return grid


def corridor_samples(routes: Sequence[Sequence[LatLon]]) -> list[LatLon]:
    """Points every SAMPLE_MI along each route, both ends included."""
    out: list[LatLon] = []
    for line in routes:
        out.append(line[0])
        since = 0.0
        for a, b in pairwise(line):
            seg = haversine_mi(a, b)
            at = SAMPLE_MI - since
            while at <= seg:
                t = at / seg
                out.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
                at += SAMPLE_MI
            since = seg - (at - SAMPLE_MI)
        out.append(line[-1])
    return out


def _length(line: Sequence[LatLon]) -> float:
    return sum(haversine_mi(a, b) for a, b in pairwise(line))


def _grid(samples: Sequence[LatLon], tenths: int) -> Grid:
    lats = [lat for lat, _ in samples]
    lons = [lon for _, lon in samples]
    dlat = tenths / 10
    # Roughly square cells on the ground; longitude steps stay multiples of 0.1 for the cache.
    mid = math.radians((min(lats) + max(lats)) / 2)
    dlon = max(0.1, round(dlat / math.cos(mid), 1))
    reach_lat = BUFFER_MI / MI_PER_DEG_LAT
    widest = math.cos(math.radians(min(max(abs(v) for v in lats), 85.0)))
    reach_lon = BUFFER_MI / (MI_PER_DEG_LAT * widest)

    lat0 = round(math.floor((min(lats) - reach_lat) / dlat) * dlat, 1)
    lon0 = round(math.floor((min(lons) - reach_lon) / dlon) * dlon, 1)
    rows = math.ceil((max(lats) + reach_lat - lat0) / dlat) + 1
    cols = math.ceil((max(lons) + reach_lon - lon0) / dlon) + 1

    inside: set[int] = set()
    for lat, lon in samples:
        mi_per_deg_lon = MI_PER_DEG_LAT * math.cos(math.radians(lat))
        first = max(0, math.ceil((lat - reach_lat - lat0) / dlat))
        last = min(rows - 1, math.floor((lat + reach_lat - lat0) / dlat))
        for row in range(first, last + 1):
            dy = (lat0 + row * dlat - lat) * MI_PER_DEG_LAT
            left = BUFFER_MI * BUFFER_MI - dy * dy
            if left < 0:
                continue
            half = math.sqrt(left) / mi_per_deg_lon
            west = max(0, math.ceil((lon - half - lon0) / dlon))
            east = min(cols - 1, math.floor((lon + half - lon0) / dlon))
            inside.update(range(row * cols + west, row * cols + east + 1))
    return Grid(lat0, lon0, dlat, dlon, rows, cols, tuple(sorted(inside)))
