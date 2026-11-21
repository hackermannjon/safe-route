from datetime import UTC, datetime, timedelta, timezone

import pytest

from routing_api.services.checkpoints import build_checkpoints
from routing_api.services.types import RouteCandidate

MILES_PER_DEG_LAT = 69.0934  # mean-radius sphere, matches geo.haversine_mi


def straight_route(length_mi: float, mph: float = 60.0, step_mi: float = 2.5) -> RouteCandidate:
    """Due-north route at constant speed, so the expected ETA is simply mile / mph."""
    count = int(length_mi / step_mi)
    miles = [i * step_mi for i in range(count + 1)]
    if miles[-1] < length_mi:
        miles.append(length_mi)
    points = [(40.0 + m / MILES_PER_DEG_LAT, -100.0) for m in miles]
    seconds = [m / mph * 3600 for m in miles]
    return RouteCandidate(
        points=points,
        cum_miles=miles,
        cum_seconds=seconds,
        distance_mi=length_mi,
        duration_s=seconds[-1],
    )


DEPARTURE = datetime(2026, 11, 21, 14, 0, tzinfo=UTC)


def test_spacing_includes_origin_and_destination():
    checkpoints = build_checkpoints(straight_route(35.0), 10, DEPARTURE)
    assert [c.mile for c in checkpoints] == [0, 10, 20, 30, 35]
    assert [c.index for c in checkpoints] == [0, 1, 2, 3, 4]


@pytest.mark.parametrize("spacing", [10, 25, 50])
def test_every_spacing_step(spacing):
    checkpoints = build_checkpoints(straight_route(1018.4), spacing, DEPARTURE)
    miles = [c.mile for c in checkpoints]
    assert miles[0] == 0
    assert miles[-1] == pytest.approx(1018.4)
    assert all(b - a == spacing for a, b in zip(miles[:-2], miles[1:-1], strict=True))
    assert 0 < miles[-1] - miles[-2] <= spacing


def test_skips_spaced_point_within_a_mile_of_destination():
    miles = [c.mile for c in build_checkpoints(straight_route(30.6), 10, DEPARTURE)]
    assert miles == [0, 10, 20, 30.6]
    # Just over a mile away still earns its own checkpoint.
    miles = [c.mile for c in build_checkpoints(straight_route(31.2), 10, DEPARTURE)]
    assert miles == [0, 10, 20, 30, 31.2]


def test_route_shorter_than_spacing_has_only_the_ends():
    miles = [c.mile for c in build_checkpoints(straight_route(7.5), 25, DEPARTURE)]
    assert miles == [0, 7.5]


def test_eta_follows_cumulative_time():
    checkpoints = build_checkpoints(straight_route(100.0, mph=50.0), 25, DEPARTURE)
    assert checkpoints[0].eta == DEPARTURE
    assert checkpoints[1].eta == DEPARTURE + timedelta(minutes=30)
    assert checkpoints[-1].eta == DEPARTURE + timedelta(hours=2)
    assert all(c.eta.tzinfo is UTC for c in checkpoints)


def test_eta_interpolates_uneven_speed():
    # 10 mi in 10 min, then 10 mi in 30 min (traffic); mile 15 is halfway through the slow part.
    route = RouteCandidate(
        points=[
            (40.0, -100.0),
            (40.0 + 10 / MILES_PER_DEG_LAT, -100.0),
            (40.0 + 20 / MILES_PER_DEG_LAT, -100.0),
        ],
        cum_miles=[0.0, 10.0, 20.0],
        cum_seconds=[0.0, 600.0, 2400.0],
        distance_mi=20.0,
        duration_s=2400.0,
    )
    checkpoints = build_checkpoints(route, 5, DEPARTURE)
    by_mile = {c.mile: c.eta - DEPARTURE for c in checkpoints}
    assert by_mile[5] == timedelta(minutes=5)
    assert by_mile[15] == timedelta(minutes=25)


def test_position_is_interpolated_along_the_shape():
    checkpoints = build_checkpoints(straight_route(60.0), 25, DEPARTURE)
    assert checkpoints[0].lat == 40.0
    assert checkpoints[1].lat == pytest.approx(40.0 + 25 / MILES_PER_DEG_LAT, abs=1e-5)
    assert all(c.lon == -100.0 for c in checkpoints)


def test_departure_is_normalized_to_utc():
    local = datetime(2026, 11, 21, 8, 0, tzinfo=timezone(timedelta(hours=-6)))
    checkpoints = build_checkpoints(straight_route(10.0), 10, local)
    assert checkpoints[0].eta == DEPARTURE
    assert checkpoints[0].eta.utcoffset() == timedelta(0)

    naive = build_checkpoints(straight_route(10.0), 10, datetime(2026, 11, 21, 14, 0))
    assert naive[0].eta == DEPARTURE


def test_rejects_non_positive_spacing():
    with pytest.raises(ValueError):
        build_checkpoints(straight_route(10.0), 0, DEPARTURE)
