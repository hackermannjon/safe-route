"""Truck routes from Valhalla, with OSRM as a fallback.

Public routers rarely return three genuinely different alternatives, so missing ones are
synthesized by forcing the route through points offset to either side of the main route.
"""

from __future__ import annotations

import asyncio
import math
import re
from collections import defaultdict
from collections.abc import Awaitable, Callable, Sequence
from itertools import accumulate

import httpx
from asgiref.sync import async_to_sync
from django.conf import settings
from django.core.cache import cache

from .errors import UpstreamError, ValidationProblem
from .geo import (
    bearing_deg,
    cumulative_miles,
    decode_polyline,
    destination_point,
    haversine_mi,
    interpolate_along,
    out_and_back_spans,
)
from .types import LatLon, Place, RouteCandidate, RouteSource

TIMEOUT = httpx.Timeout(10.0, connect=5.0, pool=None)
# Keeps bursts to the shared public routers polite; waiting for a slot is bounded by the budget.
LIMITS = httpx.Limits(max_connections=4)
# Whole routing step, so a slow router yields a clean 502 well inside a worker timeout.
ROUTING_BUDGET_S = 18.0
# Valhalla's share of it for the main route, leaving OSRM (about 2 s coast to coast) time to
# answer when the truck router is slow.
VALHALLA_MAIN_BUDGET_S = 12.0
CACHE_TTL_S = 20 * 60

LB_TO_TONNES = 0.000453592
# Valhalla's truck weight is the gross vehicle weight, so the rig itself has to be added to the
# cargo. 35,000 lb is a typical tractor with an empty 53 ft trailer.
TRUCK_TARE_LB = 35_000
MAX_GROSS_LB = 80_000  # US federal gross limit on Interstates
METERS_PER_MILE = 1609.344

VIA_FRACTIONS = (1 / 3, 2 / 3)
VIA_OFFSET_RATIO = 0.12  # of the straight-line trip distance
MAX_OVERLAP = 0.85
MAX_DURATION_RATIO = 1.40
# Two routes "share" a stretch when samples taken every OVERLAP_STEP_MI fall in the same or an
# adjacent grid cell (~0.5 mi), which absorbs divided-highway carriageways and shape noise.
OVERLAP_STEP_MI = 0.25
OVERLAP_CELL_DEG = 0.007

VALHALLA_NO_ROUTE_CODES = {170, 171, 442, 443}
# The public instance rejects requests whose locations span more than 1,500 km (932 mi) in a
# straight line. The small margin keeps Chicago-Denver (918 mi) a single request with alternates.
VALHALLA_MAX_CROW_MI = 925.0
# Waypoints added to get under that limit snap to a major road nearby, not the nearest farm track.
BRIDGE_FILTER = {"min_road_class": "primary"}
BRIDGE_SEARCH_CUTOFF_M = 80_000
NO_ROUTE = "No truck route was found between these places."
ROAD_REF = re.compile(r"^(I|US|SR|[A-Z]{2})[ -]?(\d+[A-Z]?)\b")
# OSM also tags ramps and short stretches with the number spelled out ("South Interstate 45").
SPELLED_REF = re.compile(
    r"^(?:(?:north|south|east|west)\s+)?"
    r"(interstate|u\.?s\.?\s+(?:highway|route)|state\s+highway|state\s+route)\s+(\d+[A-Z]?)\b",
    re.IGNORECASE,
)
SPELLED_PREFIX = {"interstate": "I", "state highway": "SH", "state route": "SR"}
SIDE_ROAD = re.compile(r"\b(frontage|service|access)\s+road\b", re.IGNORECASE)
NORMALISED_REF = re.compile(r"^[A-Z]{1,2}-\d")
# A road carrying under this share of the named mileage is a ramp or a town street, not a "via".
MIN_VIA_SHARE = 0.02

Fetcher = Callable[[httpx.AsyncClient, Sequence[LatLon]], Awaitable[list[RouteCandidate]]]


def fetch_routes(
    origin: Place, destination: Place, cargo_lb: float = 0, max_routes: int = 3
) -> list[RouteCandidate]:
    """Up to `max_routes` distinct routes, fastest first. Re-plans of the same trip are cached."""
    weight_t = truck_weight_t(cargo_lb)
    key = (
        f"routes:v3:{origin.lat:.4f}:{origin.lon:.4f}:{destination.lat:.4f}:{destination.lon:.4f}"
        f":{weight_t}:{max_routes}"
    )
    cached = cache.get(key)
    if cached is not None:
        return cached
    routes, complete = async_to_sync(_fetch_routes)(origin, destination, weight_t, max_routes)
    # A result trimmed by an upstream failure would otherwise stick for the whole TTL.
    if complete:
        cache.set(key, routes, CACHE_TTL_S)
    return routes


def truck_weight_t(cargo_lb: float) -> float:
    """Gross vehicle weight in metric tonnes, as Valhalla's truck costing expects."""
    return round(min(TRUCK_TARE_LB + cargo_lb, MAX_GROSS_LB) * LB_TO_TONNES, 2)


async def _fetch_routes(
    origin: Place, destination: Place, weight_t: float, max_routes: int
) -> tuple[list[RouteCandidate], bool]:
    """Routes plus whether every upstream call that shaped them succeeded."""
    ends = [(origin.lat, origin.lon), (destination.lat, destination.lon)]
    deadline = asyncio.get_running_loop().time() + ROUTING_BUDGET_S
    complete = True

    async def valhalla(client: httpx.AsyncClient, stops: Sequence[LatLon]):
        return await _valhalla(client, stops, weight_t)

    async with httpx.AsyncClient(
        timeout=TIMEOUT, limits=LIMITS, headers={"User-Agent": settings.HTTP_USER_AGENT}
    ) as client:
        fetcher: Fetcher = valhalla
        try:
            async with asyncio.timeout_at(deadline):
                try:
                    async with asyncio.timeout(VALHALLA_MAIN_BUDGET_S):
                        first = await valhalla(client, ends)
                except (UpstreamError, ValidationProblem, TimeoutError) as exc:
                    # Truck restrictions can leave Valhalla without a path where a car router
                    # finds one; an outage or a slow answer, unlike that, is not worth
                    # remembering.
                    complete = isinstance(exc, ValidationProblem)
                    fetcher = _osrm
                    first = await _osrm(client, ends)
        except TimeoutError as exc:
            raise UpstreamError("The routing service took too long to respond.") from exc

        routes = select_distinct(first, max_routes)
        if not routes:
            raise ValidationProblem(NO_ROUTE, field="destination")
        if len(routes) < max_routes:
            extra, detours_complete = await _detours(client, fetcher, routes[0], ends, deadline)
            complete = complete and detours_complete
            routes = select_distinct(routes + extra, max_routes)
            if len(routes) < max_routes and not detours_complete and fetcher is not _osrm:
                # Truck detours lost to an outage or the budget: a general road router's
                # alternatives still give the driver a choice, and the plan says which they are.
                routes = select_distinct(
                    routes + await _osrm_spare(client, ends, deadline), max_routes
                )

    return sorted(routes, key=lambda r: r.duration_s), complete


async def _detours(
    client: httpx.AsyncClient,
    fetcher: Fetcher,
    main: RouteCandidate,
    ends: Sequence[LatLon],
    deadline: float,
) -> tuple[list[RouteCandidate], bool]:
    """Routes forced through points beside the main one.

    Detours are optional: one that fails or runs past the budget is simply not offered.
    """
    remaining = deadline - asyncio.get_running_loop().time()
    if remaining <= 0:
        return [], False
    tasks = [
        asyncio.ensure_future(fetcher(client, [ends[0], via, ends[1]]))
        for via in via_points(main, ends[0], ends[1])
    ]
    done, pending = await asyncio.wait(tasks, timeout=remaining)
    for task in pending:
        task.cancel()
    await asyncio.gather(*pending, return_exceptions=True)

    complete = not pending
    extra: list[RouteCandidate] = []
    for task in tasks:
        if task not in done:
            continue
        exc = task.exception()
        if isinstance(exc, ValidationProblem):
            continue  # no drivable road through that point, which is a stable answer
        if isinstance(exc, UpstreamError):
            complete = False
            continue
        if exc is not None:
            raise exc
        extra.extend(task.result())
    extra.sort(key=lambda r: r.duration_s)
    return extra, complete


async def _osrm_spare(
    client: httpx.AsyncClient, ends: Sequence[LatLon], deadline: float
) -> list[RouteCandidate]:
    """OSRM alternatives to fill a short list, or none if OSRM cannot answer in time either."""
    if deadline - asyncio.get_running_loop().time() <= 0:
        return []
    try:
        async with asyncio.timeout_at(deadline):
            return await _osrm(client, ends)
    except (UpstreamError, ValidationProblem, TimeoutError):
        return []


def select_distinct(candidates: Sequence[RouteCandidate], limit: int) -> list[RouteCandidate]:
    """Keep candidates in order, skipping near-duplicates and unreasonable detours."""
    if not candidates:
        return []
    fastest = min(c.duration_s for c in candidates)
    kept: list[RouteCandidate] = []
    kept_cells: list[set[tuple[int, int]]] = []
    for candidate in candidates:
        if len(kept) >= limit:
            break
        if kept and candidate.duration_s > fastest * MAX_DURATION_RATIO:
            continue
        samples = _cells(candidate)
        if any(_overlap(samples, cells) > MAX_OVERLAP for cells in kept_cells):
            continue
        kept.append(candidate)
        kept_cells.append(set(samples))
    return kept


def _cells(route: RouteCandidate) -> list[tuple[int, int]]:
    total = route.cum_miles[-1]
    count = max(1, int(total / OVERLAP_STEP_MI))
    cells = []
    for k in range(count + 1):
        lat, lon = interpolate_along(route.points, route.cum_miles, total * k / count)
        cells.append((round(lat / OVERLAP_CELL_DEG), round(lon / OVERLAP_CELL_DEG)))
    return cells


def _overlap(samples: list[tuple[int, int]], other: set[tuple[int, int]]) -> float:
    hits = sum(
        1
        for y, x in samples
        if any((y + dy, x + dx) in other for dy in (-1, 0, 1) for dx in (-1, 0, 1))
    )
    return hits / len(samples)


def via_points(main: RouteCandidate, origin: LatLon, destination: LatLon) -> list[LatLon]:
    """Points offset perpendicular to the main route at 1/3 and 2/3 of its length, both sides."""
    total = main.cum_miles[-1]
    offset = haversine_mi(origin, destination) * VIA_OFFSET_RATIO
    # Heading over a +/-5% window ignores local wiggles such as interchanges.
    window = total * 0.05
    vias = []
    for fraction in VIA_FRACTIONS:
        at = total * fraction
        anchor = interpolate_along(main.points, main.cum_miles, at)
        heading = bearing_deg(
            interpolate_along(main.points, main.cum_miles, at - window),
            interpolate_along(main.points, main.cum_miles, at + window),
        )
        for side in (90.0, -90.0):
            vias.append(destination_point(anchor, (heading + side) % 360.0, offset))
    return vias


async def _valhalla(
    client: httpx.AsyncClient, stops: Sequence[LatLon], weight_t: float
) -> list[RouteCandidate]:
    path, bridges = _bridge(stops)
    if len(path) > 2 and _crow_miles(path) > VALHALLA_MAX_CROW_MI:
        # The public instance caps the summed straight-line distance of one request, so a long
        # trip is routed as consecutive A-to-B requests and stitched at the shared points.
        parts = await asyncio.gather(
            *(_valhalla_trips(client, pair, weight_t, bridges) for pair in _pairs(path)),
            return_exceptions=True,
        )
        for part in parts:
            if isinstance(part, BaseException):
                raise part
        firsts = [trips[0] for trips in parts]
        try:
            trips = [
                {
                    "legs": [leg for trip in firsts for leg in trip["legs"]],
                    "summary": {
                        "length": sum(float(t["summary"]["length"]) for t in firsts),
                        "time": sum(float(t["summary"]["time"]) for t in firsts),
                    },
                }
            ]
        except (KeyError, TypeError, ValueError) as exc:
            raise UpstreamError("The routing service returned an unexpected response.") from exc
    else:
        # Valhalla only computes alternates for plain A-to-B requests.
        trips = await _valhalla_trips(client, path, weight_t, bridges, alternates=len(path) == 2)

    try:
        return [_from_valhalla(trip) for trip in trips]
    except (KeyError, TypeError, ValueError, IndexError) as exc:
        raise UpstreamError("The routing service returned an unexpected response.") from exc


async def _valhalla_trips(
    client: httpx.AsyncClient,
    stops: Sequence[LatLon],
    weight_t: float,
    bridges: frozenset[LatLon] = frozenset(),
    alternates: bool = False,
) -> list[dict]:
    last = len(stops) - 1
    locations = []
    for i, (lat, lon) in enumerate(stops):
        location = {"lat": lat, "lon": lon, "type": "break" if i in (0, last) else "through"}
        if (lat, lon) in bridges:
            location["search_filter"] = BRIDGE_FILTER
            location["search_cutoff"] = BRIDGE_SEARCH_CUTOFF_M
        locations.append(location)
    body = {
        "locations": locations,
        "costing": "truck",
        "costing_options": {"truck": {"weight": weight_t}},
        "units": "miles",
        "directions_options": {"units": "miles", "directions_type": "maneuvers"},
    }
    if alternates:
        body["alternates"] = 2

    try:
        response = await client.post(f"{settings.VALHALLA_URL.rstrip('/')}/route", json=body)
    except httpx.HTTPError as exc:
        raise UpstreamError("The routing service is unavailable.") from exc
    payload = _json(response)
    if response.status_code != 200:
        if payload.get("error_code") in VALHALLA_NO_ROUTE_CODES:
            raise ValidationProblem(NO_ROUTE, field="destination")
        raise UpstreamError(f"The routing service failed ({response.status_code}).")
    try:
        return [payload["trip"]] + [alt["trip"] for alt in payload.get("alternates", [])]
    except (KeyError, TypeError) as exc:
        raise UpstreamError("The routing service returned an unexpected response.") from exc


def _bridge(stops: Sequence[LatLon]) -> tuple[list[LatLon], frozenset[LatLon]]:
    """Add evenly spaced great-circle waypoints so no hop exceeds the router's span limit.

    Returns the full path and the subset of points that were added.
    """
    path = [stops[0]]
    added = []
    for a, b in _pairs(stops):
        distance = haversine_mi(a, b)
        hops = math.ceil(distance / VALHALLA_MAX_CROW_MI)
        heading = bearing_deg(a, b)
        for k in range(1, hops):
            added.append(destination_point(a, heading, distance * k / hops))
            path.append(added[-1])
        path.append(b)
    return path, frozenset(added)


def _pairs(stops: Sequence[LatLon]) -> list[tuple[LatLon, LatLon]]:
    return list(zip(stops, stops[1:], strict=False))


def _crow_miles(stops: Sequence[LatLon]) -> float:
    return sum(haversine_mi(a, b) for a, b in _pairs(stops))


def _from_valhalla(trip: dict) -> RouteCandidate:
    points: list[LatLon] = []
    segment_seconds: list[float] = []
    names: dict[str, float] = defaultdict(float)
    first_seen: dict[str, int] = {}
    for leg in trip["legs"]:
        shape = decode_polyline(leg["shape"], 6)
        # Consecutive legs share their joint point; drop it so indices stay contiguous.
        base = len(points) - 1 if points else 0
        points.extend(shape[1:] if points else shape)
        segment_seconds.extend([0.0] * (len(points) - 1 - len(segment_seconds)))
        for maneuver in leg["maneuvers"]:
            begin = base + int(maneuver["begin_shape_index"])
            end = base + int(maneuver["end_shape_index"])
            _spread(points, segment_seconds, begin, end, float(maneuver.get("time", 0.0)))
            name = road_name(maneuver.get("street_names") or [])
            if name:
                names[name] += float(maneuver.get("length", 0.0))
                first_seen.setdefault(name, len(first_seen))

    summary = trip["summary"]
    return _candidate(
        points,
        segment_seconds,
        distance_mi=float(summary["length"]),
        duration_s=float(summary["time"]),
        via=main_roads(names, first_seen),
        source="valhalla",
    )


def _spread(
    points: list[LatLon], segment_seconds: list[float], begin: int, end: int, seconds: float
) -> None:
    """Share a maneuver's time among its shape segments in proportion to their length."""
    if seconds <= 0 or not segment_seconds:
        return
    begin = min(begin, len(segment_seconds) - 1)
    end = min(max(end, begin + 1), len(segment_seconds))
    lengths = [haversine_mi(points[i], points[i + 1]) for i in range(begin, end)]
    total = sum(lengths)
    for offset, length in enumerate(lengths):
        share = length / total if total > 0 else 1 / len(lengths)
        segment_seconds[begin + offset] += seconds * share


def road_name(street_names: Sequence[str]) -> str | None:
    """Prefer a route number ("I 80 Expr", "South Interstate 45" -> "I-80", "I-45").

    Frontage and service roads are skipped: they run beside the highway the route is really on.
    """
    names = [n.strip() for n in street_names if n.strip() and not SIDE_ROAD.search(n)]
    for raw in names:
        ref = _road_ref(raw)
        if ref:
            return ref
    return names[0] if names else None


def _road_ref(raw: str) -> str | None:
    match = ROAD_REF.match(raw)
    if match:
        return f"{match.group(1)}-{match.group(2)}"
    match = SPELLED_REF.match(raw)
    if match:
        kind = " ".join(match.group(1).lower().replace(".", "").split())
        prefix = "US" if kind.startswith("us") else SPELLED_PREFIX[kind]
        return f"{prefix}-{match.group(2).upper()}"
    return None


def main_roads(lengths: dict[str, float], first_seen: dict[str, int]) -> list[str]:
    """Up to three of the longest roads, in driving order.

    When any numbered route is known, street names are left out: "I-45" says more to a driver
    than the downtown street the trip starts on.
    """
    refs = [n for n in lengths if NORMALISED_REF.match(n)]
    pool = refs or list(lengths)
    total = sum(lengths[n] for n in pool)
    top = sorted(pool, key=lambda n: lengths[n], reverse=True)[:3]
    kept = [n for i, n in enumerate(top) if i == 0 or lengths[n] >= total * MIN_VIA_SHARE]
    return sorted(kept, key=lambda n: first_seen[n])


async def _osrm(client: httpx.AsyncClient, stops: Sequence[LatLon]) -> list[RouteCandidate]:
    coords = ";".join(f"{lon:.6f},{lat:.6f}" for lat, lon in stops)
    params = {
        "overview": "full",
        "geometries": "geojson",
        "annotations": "duration",
        # Road names and route numbers only come with the turn-by-turn steps.
        "steps": "true",
        # OSRM only computes alternatives for plain A-to-B requests.
        "alternatives": "3" if len(stops) == 2 else "false",
    }
    try:
        response = await client.get(
            f"{settings.OSRM_URL.rstrip('/')}/route/v1/driving/{coords}", params=params
        )
    except httpx.HTTPError as exc:
        raise UpstreamError("The routing service is unavailable.") from exc
    payload = _json(response)
    code = payload.get("code")
    if code in ("NoRoute", "NoSegment"):
        raise ValidationProblem(NO_ROUTE, field="destination")
    if response.status_code != 200 or code != "Ok":
        raise UpstreamError(f"The routing service failed ({response.status_code}).")

    try:
        routes = [_from_osrm(route) for route in payload["routes"]]
    except (KeyError, TypeError, ValueError, IndexError) as exc:
        raise UpstreamError("The routing service returned an unexpected response.") from exc
    if not routes:
        raise ValidationProblem(NO_ROUTE, field="destination")
    return routes


def _from_osrm(route: dict) -> RouteCandidate:
    points = [(float(lat), float(lon)) for lon, lat in route["geometry"]["coordinates"]]
    segment_seconds: list[float] = []
    names: dict[str, float] = defaultdict(float)
    first_seen: dict[str, int] = {}
    for leg in route["legs"]:
        segment_seconds.extend(float(s) for s in leg["annotation"]["duration"])
        for raw_names, meters in _osrm_road_names(leg):
            name = road_name(raw_names)
            if name:
                names[name] += meters / METERS_PER_MILE
                first_seen.setdefault(name, len(first_seen))
    # Multi-leg annotations can disagree with the overview by a point; pad or trim to fit.
    segment_seconds = segment_seconds[: len(points) - 1]
    segment_seconds.extend([0.0] * (len(points) - 1 - len(segment_seconds)))
    return _candidate(
        points,
        segment_seconds,
        distance_mi=float(route["distance"]) / METERS_PER_MILE,
        duration_s=float(route["duration"]),
        via=main_roads(names, first_seen),
        source="osrm",
    )


def _osrm_road_names(leg: dict) -> list[tuple[list[str], float]]:
    """(names, meters) per stretch of a leg, route numbers first, as `road_name` expects.

    Steps carry `ref` ("I 40; US 117") and `name` with their own length. A leg without steps
    falls back to its summary, which names the main roads but not how long each one is.
    """
    steps = leg.get("steps") or []
    if steps:
        return [
            (
                [r for r in (step.get("ref") or "").split(";")] + [step.get("name") or ""],
                float(step.get("distance", 0.0)),
            )
            for step in steps
        ]
    meters = float(leg.get("distance", 0.0))
    return [([raw], meters) for raw in (leg.get("summary") or "").split(",")]


def _candidate(
    points: list[LatLon],
    segment_seconds: list[float],
    *,
    distance_mi: float,
    duration_s: float,
    via: list[str],
    source: RouteSource,
) -> RouteCandidate:
    if len(points) < 2:
        raise ValueError("route geometry is too short")
    points, segment_seconds, distance_mi, duration_s = _without_spurs(
        points, segment_seconds, distance_mi, duration_s
    )
    segment_miles = [haversine_mi(a, b) for a, b in _pairs(points)]
    # Rescale so the last values match the router's own totals exactly; the per-point shape of
    # each series is what carries the information.
    cum_miles = _scaled([0.0, *accumulate(segment_miles)], distance_mi)
    cum_seconds = _scaled([0.0, *accumulate(segment_seconds)], duration_s)
    return RouteCandidate(
        points=points,
        cum_miles=cum_miles,
        cum_seconds=cum_seconds,
        distance_mi=distance_mi,
        duration_s=duration_s,
        via=via,
        source=source,
    )


def _without_spurs(
    points: list[LatLon], segment_seconds: list[float], distance_mi: float, duration_s: float
) -> tuple[list[LatLon], list[float], float, float]:
    """Drop stretches the route drives out and straight back along.

    Routers produce these when a waypoint (a stitch point or a detour's via) snaps onto a side
    road, and Valhalla occasionally turns a truck around at a roundabout. Either way the truck
    ends up where it started, so the stretch only adds miles and hours to every later ETA.
    """
    spans = out_and_back_spans(points)
    if not spans:
        return points, segment_seconds, distance_mi, duration_s
    raw_miles, raw_seconds = cumulative_miles(points)[-1], sum(segment_seconds)
    kept_points: list[LatLon] = []
    kept_seconds: list[float] = []
    resume = 0
    for start, end in spans:
        kept_points.extend(points[resume : start + 1])
        # The two ends of a spur are a few metres apart, so the hop between them takes no time.
        kept_seconds.extend([*segment_seconds[resume:start], 0.0])
        resume = end
    kept_points.extend(points[resume:])
    kept_seconds.extend(segment_seconds[resume:])
    # The router's totals shrink by what was cut, measured with its own per-segment times, so a
    # spur driven slowly (a ramp, a roundabout) costs what it really cost.
    if raw_miles > 0:
        distance_mi *= cumulative_miles(kept_points)[-1] / raw_miles
    if raw_seconds > 0:
        duration_s *= sum(kept_seconds) / raw_seconds
    return kept_points, kept_seconds, distance_mi, duration_s


def _scaled(values: list[float], total: float) -> list[float]:
    current = values[-1]
    if current <= 0:
        # No usable per-point data: spread evenly so later points still come later.
        step = total / (len(values) - 1)
        return [i * step for i in range(len(values))]
    factor = total / current
    return [v * factor for v in values]


def _json(response: httpx.Response) -> dict:
    try:
        payload = response.json()
    except ValueError:
        return {}
    return payload if isinstance(payload, dict) else {}
