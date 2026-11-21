"""Evenly spaced checkpoints along a route, each with the truck's ETA."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from .geo import interpolate_along, interpolate_value
from .types import Checkpoint, RouteCandidate

# A spaced checkpoint this close to the destination only duplicates it.
MIN_GAP_BEFORE_DESTINATION_MI = 1.0


def build_checkpoints(
    route: RouteCandidate, spacing_mi: int, departure: datetime
) -> list[Checkpoint]:
    if spacing_mi <= 0:
        raise ValueError("spacing_mi must be positive")
    if not route.points:
        raise ValueError("route has no geometry")

    start = departure.astimezone(UTC) if departure.tzinfo else departure.replace(tzinfo=UTC)
    total = route.cum_miles[-1]

    miles = [0.0]
    mile = float(spacing_mi)
    while total - mile > MIN_GAP_BEFORE_DESTINATION_MI:
        miles.append(mile)
        mile += spacing_mi
    miles.append(total)

    checkpoints = []
    for index, at in enumerate(miles):
        lat, lon = interpolate_along(route.points, route.cum_miles, at)
        seconds = interpolate_value(route.cum_miles, route.cum_seconds, at)
        checkpoints.append(
            Checkpoint(
                index=index,
                mile=at,
                lat=round(lat, 5),
                lon=round(lon, 5),
                eta=start + timedelta(seconds=round(seconds)),
            )
        )
    return checkpoints
