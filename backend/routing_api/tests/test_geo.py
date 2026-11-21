import pytest

from routing_api.services.geo import (
    bearing_deg,
    cumulative_miles,
    decode_polyline,
    destination_point,
    haversine_mi,
    interpolate_along,
    out_and_back_spans,
    simplify,
    to_lonlat,
)

CHICAGO = (41.878, -87.629)
DENVER = (39.739, -104.990)


def test_haversine_known_distances():
    assert haversine_mi(CHICAGO, CHICAGO) == 0
    # One degree of latitude is ~69.09 statute miles on the mean-radius sphere.
    assert haversine_mi((40.0, -100.0), (41.0, -100.0)) == pytest.approx(69.09, abs=0.01)
    assert haversine_mi(CHICAGO, DENVER) == pytest.approx(920, abs=3)
    assert haversine_mi(CHICAGO, DENVER) == pytest.approx(haversine_mi(DENVER, CHICAGO))


def test_bearing_cardinal_directions():
    assert bearing_deg((0, 0), (1, 0)) == pytest.approx(0)
    assert bearing_deg((0, 0), (0, 1)) == pytest.approx(90)
    assert bearing_deg((0, 0), (-1, 0)) == pytest.approx(180)
    assert bearing_deg((0, 0), (0, -1)) == pytest.approx(270)


def test_destination_point_round_trips_with_bearing_and_distance():
    target = destination_point(CHICAGO, 250.0, 120.0)
    assert haversine_mi(CHICAGO, target) == pytest.approx(120.0, rel=1e-6)
    assert bearing_deg(CHICAGO, target) == pytest.approx(250.0, abs=1e-6)


def test_destination_point_wraps_longitude():
    lat, lon = destination_point((0.0, 179.9), 90.0, 50.0)
    assert -180 <= lon < -179


def test_decode_polyline_reference_vector():
    # Reference example from the encoded polyline format specification (precision 5).
    encoded = "_p~iF~ps|U_ulLnnqC_mqNvxq`@"
    assert decode_polyline(encoded, precision=5) == [
        (38.5, -120.2),
        (40.7, -120.95),
        (43.252, -126.453),
    ]


def test_decode_polyline_precision_six_scales_the_same_integers():
    points = decode_polyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@")
    assert points[0] == pytest.approx((3.85, -12.02))
    assert points[2] == pytest.approx((4.3252, -12.6453))


def test_decode_polyline_empty():
    assert decode_polyline("") == []


def test_cumulative_miles():
    points = [(40.0, -100.0), (41.0, -100.0), (41.0, -100.0), (42.0, -100.0)]
    cum = cumulative_miles(points)
    assert cum[0] == 0
    assert cum[1] == pytest.approx(69.09, abs=0.01)
    assert cum[2] == cum[1]
    assert cum[3] == pytest.approx(2 * cum[1], abs=0.01)
    assert cumulative_miles([]) == []
    assert cumulative_miles([CHICAGO]) == [0.0]


def test_interpolate_along_is_linear_and_clamped():
    points = [(0.0, 0.0), (0.0, 10.0), (10.0, 10.0)]
    cum = [0.0, 10.0, 20.0]
    assert interpolate_along(points, cum, 5.0) == pytest.approx((0.0, 5.0))
    assert interpolate_along(points, cum, 10.0) == pytest.approx((0.0, 10.0))
    assert interpolate_along(points, cum, 15.0) == pytest.approx((5.0, 10.0))
    assert interpolate_along(points, cum, -3.0) == (0.0, 0.0)
    assert interpolate_along(points, cum, 99.0) == pytest.approx((10.0, 10.0))
    assert interpolate_along([CHICAGO], [0.0], 4.0) == CHICAGO


def test_interpolate_along_skips_zero_length_segments():
    points = [(0.0, 0.0), (0.0, 1.0), (0.0, 1.0), (0.0, 2.0)]
    cum = [0.0, 1.0, 1.0, 2.0]
    assert interpolate_along(points, cum, 1.5) == pytest.approx((0.0, 1.5))


def test_simplify_collapses_collinear_points():
    line = [(0.0, i / 10) for i in range(101)]
    assert simplify(line, 0.0005) == [(0.0, 0.0), (0.0, 10.0)]


def test_simplify_keeps_significant_vertices():
    zigzag = [(0.0, 0.0), (0.5001, 1.0), (1.0, 2.0), (0.0, 3.0)]
    assert simplify(zigzag, 0.01) == [(0.0, 0.0), (1.0, 2.0), (0.0, 3.0)]


def test_simplify_handles_long_lines_without_recursion():
    # A zigzag whose swing shrinks along the line: every split keeps the point right next to
    # the start as the worst, so a recursive version would nest once per point, past Python's
    # default limit of 1,000, while the input stays small enough to simplify in a blink.
    count = 1500
    points = [((-1) ** i * (count - i) * 1e-5, i * 1e-4) for i in range(count)]
    assert simplify(points, 1e-6) == points


def test_simplify_short_inputs():
    assert simplify([], 0.1) == []
    assert simplify([CHICAGO, DENVER], 0.1) == [CHICAGO, DENVER]


def test_to_lonlat_swaps_and_rounds():
    assert to_lonlat([(41.8781234567, -87.6298765432)]) == [[-87.62988, 41.87812]]


def line(*stops, step_mi=0.05):
    """Straight segments through the stops with a vertex every `step_mi`."""
    points = [stops[0]]
    for a, b in zip(stops, stops[1:], strict=False):
        count = max(1, round(haversine_mi(a, b) / step_mi))
        points += [
            (a[0] + (b[0] - a[0]) * k / count, a[1] + (b[1] - a[1]) * k / count)
            for k in range(1, count + 1)
        ]
    return points


# Roughly a mile in each direction at 40 degrees north.
MI_LAT, MI_LON = 1 / 69.0, 1 / 53.0
BASE = (40.67, -99.03)


def east(origin, miles):
    return (origin[0], origin[1] + miles * MI_LON)


def north(origin, miles, offset_mi=0.0):
    return (origin[0] + miles * MI_LAT, origin[1] + offset_mi * MI_LON)


def test_straight_line_has_no_spurs():
    assert out_and_back_spans(line(east(BASE, -10), east(BASE, 10))) == []


def test_finds_a_road_driven_out_and_back():
    tip = north(BASE, 3)
    points = line(east(BASE, -5), BASE, tip, BASE, east(BASE, 5))
    ((start, end),) = out_and_back_spans(points)
    assert haversine_mi(points[start], points[end]) <= 0.025
    kept = points[: start + 1] + points[end:]
    assert max(lat for lat, _ in kept) < BASE[0] + 0.1 * MI_LAT


def test_divided_road_with_a_roundabout_turnaround_counts_as_a_spur():
    # Out on one carriageway, around a small loop, back on the other ~25 m away, with
    # vertices that never line up between the two directions.
    out = line(BASE, north(BASE, 3), step_mi=0.3)
    loop = [north(BASE, 3.03, 0.02), north(BASE, 3.05, 0.0), north(BASE, 3.03, -0.02)]
    back = line(north(BASE, 3, 0.015), north(BASE, 0, 0.015), step_mi=0.37)
    points = line(east(BASE, -5), BASE)[:-1] + out + loop + back + line(BASE, east(BASE, 5))[1:]
    spans = out_and_back_spans(points)
    assert len(spans) == 1
    start, end = spans[0]
    assert cumulative_miles(points[start : end + 1])[-1] > 5.5


def test_a_loop_that_closes_on_itself_is_not_a_spur():
    # A square block: the line comes back to where it started without retracing anything.
    points = line(
        east(BASE, -3),
        BASE,
        north(BASE, 0.5),
        north(BASE, 0.5, 0.5),
        north(BASE, 0, 0.5),
        BASE,
        north(BASE, -3),
    )
    assert out_and_back_spans(points) == []


def test_short_turnarounds_are_left_alone():
    # Under half a mile there and back is an interchange ramp, not a detour.
    points = line(east(BASE, -5), BASE, north(BASE, 0.2), BASE, east(BASE, 5))
    assert out_and_back_spans(points) == []
