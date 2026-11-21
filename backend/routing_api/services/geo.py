"""Small spherical-geometry toolkit. Points are (lat, lon) tuples in degrees."""

from __future__ import annotations

import math
from collections import defaultdict
from collections.abc import Sequence

from .types import LatLon

EARTH_RADIUS_MI = 3958.7613

# Out-and-back detection. Two passes count as the same road within SPUR_MATCH_MI (~40 m, the
# two carriageways of a divided road). Returns shorter than SPUR_MIN_MI are interchange ramps,
# and each half must run alongside the other for SPUR_COVERAGE of its length, which leaves room
# for the turnaround itself (a roundabout or a block) but rejects loops that merely close.
SPUR_MATCH_MI = 0.025
SPUR_MIN_MI = 0.5
SPUR_MAX_MI = 40.0
SPUR_COVERAGE = 0.8
# Grid cells no smaller than the match distance up to ~65 degrees of latitude, so a 3x3
# neighbourhood always holds every point within reach.
_SPUR_CELL_DEG = 0.001


def haversine_mi(a: LatLon, b: LatLon) -> float:
    lat1, lon1 = math.radians(a[0]), math.radians(a[1])
    lat2, lon2 = math.radians(b[0]), math.radians(b[1])
    h = (
        math.sin((lat2 - lat1) / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    )
    return 2 * EARTH_RADIUS_MI * math.asin(min(1.0, math.sqrt(h)))


def decode_polyline(encoded: str, precision: int = 6) -> list[LatLon]:
    """Google encoded polyline; Valhalla uses precision 6, most other services 5."""
    factor = 10.0**precision
    points: list[LatLon] = []
    index = lat = lon = 0
    length = len(encoded)
    while index < length:
        deltas = []
        for _ in range(2):
            shift = result = 0
            while True:
                byte = ord(encoded[index]) - 63
                index += 1
                result |= (byte & 0x1F) << shift
                shift += 5
                if byte < 0x20:
                    break
            deltas.append(~(result >> 1) if result & 1 else result >> 1)
        lat += deltas[0]
        lon += deltas[1]
        points.append((lat / factor, lon / factor))
    return points


def cumulative_miles(points: Sequence[LatLon]) -> list[float]:
    if not points:
        return []
    cum = [0.0]
    total = 0.0
    for prev, cur in zip(points, points[1:], strict=False):
        total += haversine_mi(prev, cur)
        cum.append(total)
    return cum


def out_and_back_spans(points: Sequence[LatLon]) -> list[tuple[int, int]]:
    """Index pairs (start, end) where the line drives out and straight back to where it was.

    points[start] and points[end] are within SPUR_MATCH_MI of each other, so everything strictly
    between them can be dropped. Spans are in order and never overlap; the outermost one wins.
    """
    n = len(points)
    if n < 4:
        return []
    cum = cumulative_miles(points)
    grid: dict[tuple[int, int], list[int]] = defaultdict(list)
    for k, point in enumerate(points):
        grid[_cell(point)].append(k)

    spans = []
    i = 0
    while i < n - 2:
        end = next((j for j in _returns(points, cum, grid, i) if _folds(points, cum, i, j)), None)
        if end is None:
            i += 1
        else:
            spans.append((i, end))
            i = end
    return spans


def _cell(point: LatLon) -> tuple[int, int]:
    return math.floor(point[0] / _SPUR_CELL_DEG), math.floor(point[1] / _SPUR_CELL_DEG)


def _near(points, grid, k: int):
    """Indices of points within SPUR_MATCH_MI of points[k], in no particular order."""
    y, x = _cell(points[k])
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            for other in grid.get((y + dy, x + dx), ()):
                if haversine_mi(points[k], points[other]) <= SPUR_MATCH_MI:
                    yield other


def _returns(points, cum, grid, i: int) -> list[int]:
    """Later points that come back to points[i] after a plausible spur's length, farthest first."""
    return sorted(
        (j for j in _near(points, grid, i) if SPUR_MIN_MI <= cum[j] - cum[i] <= SPUR_MAX_MI),
        reverse=True,
    )


def _folds(points, cum, start: int, end: int) -> bool:
    """Whether the stretch start..end is one road driven out and back, not a loop."""
    middle = (cum[start] + cum[end]) / 2
    tip = start
    while cum[tip + 1] <= middle:
        tip += 1
    if tip == start or tip + 1 >= end:
        return False
    # A flat projection around the spur is plenty accurate over its few miles. Matching is
    # against segments, not vertices: the carriageways of a divided road are separate ways
    # whose vertices rarely line up.
    ky = math.pi * EARTH_RADIUS_MI / 180.0
    kx = ky * math.cos(math.radians(points[start][0]))
    xy = [(lon * kx, lat * ky) for lat, lon in points[start : end + 1]]
    cut = tip - start
    out, back = xy[: cut + 1], xy[cut:]
    out_cum = cum[start : tip + 1]
    back_cum = cum[tip : end + 1]
    return _alongside(out, out_cum, back) and _alongside(back, back_cum, out)


def _alongside(side, side_cum, other) -> bool:
    """Whether SPUR_COVERAGE of `side`, by length, lies within SPUR_MATCH_MI of `other`."""
    allowed_miss = (1 - SPUR_COVERAGE) * (side_cum[-1] - side_cum[0])
    missed = 0.0
    for k in range(1, len(side)):
        if _plane_distance(side[k], other) > SPUR_MATCH_MI:
            missed += side_cum[k] - side_cum[k - 1]
            if missed > allowed_miss:
                return False
    return True


def _plane_distance(point: tuple[float, float], line) -> float:
    px, py = point
    best = math.inf
    for (ax, ay), (bx, by) in zip(line, line[1:], strict=False):
        dx, dy = bx - ax, by - ay
        seg_sq = dx * dx + dy * dy
        t = 0.0 if seg_sq == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / seg_sq))
        d = math.hypot(px - ax - t * dx, py - ay - t * dy)
        if d < best:
            best = d
            if best <= SPUR_MATCH_MI:
                break
    return best


def simplify(points: Sequence[LatLon], tolerance_deg: float) -> list[LatLon]:
    """Douglas-Peucker in degree space. Iterative: long routes overflow the recursion limit."""
    n = len(points)
    if n < 3 or tolerance_deg <= 0:
        return list(points)
    keep = [False] * n
    keep[0] = keep[-1] = True
    tol_sq = tolerance_deg * tolerance_deg
    stack = [(0, n - 1)]
    while stack:
        start, end = stack.pop()
        if end - start < 2:
            continue
        ay, ax = points[start]
        by, bx = points[end]
        dx, dy = bx - ax, by - ay
        seg_sq = dx * dx + dy * dy
        worst_sq, worst_i = -1.0, -1
        for i in range(start + 1, end):
            py, px = points[i]
            if seg_sq == 0:
                d_sq = (px - ax) ** 2 + (py - ay) ** 2
            else:
                t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / seg_sq))
                d_sq = (px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2
            if d_sq > worst_sq:
                worst_sq, worst_i = d_sq, i
        if worst_sq > tol_sq:
            keep[worst_i] = True
            stack.append((start, worst_i))
            stack.append((worst_i, end))
    return [p for p, k in zip(points, keep, strict=True) if k]


def to_lonlat(points: Sequence[LatLon]) -> list[list[float]]:
    """GeoJSON coordinate order. Five decimals is ~1 m, well below what the map can show."""
    return [[round(lon, 5), round(lat, 5)] for lat, lon in points]
