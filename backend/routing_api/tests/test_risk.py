import pytest

from routing_api.services.risk import (
    LOAD_RULE_NO_TRAVEL,
    LOAD_RULE_SEVERE,
    assess,
    classify_rain,
    classify_snow,
    classify_wind,
)
from routing_api.services.types import RiskLevel, WeatherSample

L = RiskLevel


def sample(wind=0.0, rain=0.0, snow=0.0, gust=0.0):
    return WeatherSample(wind_mph=wind, gust_mph=gust, rain_in_h=rain, snow_in_h=snow)


@pytest.mark.parametrize(
    ("mph", "expected"),
    [
        (0, L.LOW),
        (24.99, L.LOW),
        (25, L.MODERATE),
        (34.99, L.MODERATE),
        (35, L.HIGH),
        (44.99, L.HIGH),
        (45, L.SEVERE),
        (54.99, L.SEVERE),
        (55, L.NO_TRAVEL),
        (90, L.NO_TRAVEL),
    ],
)
def test_classify_wind(mph, expected):
    assert classify_wind(mph) == expected


@pytest.mark.parametrize(
    ("in_h", "expected"),
    [
        (0.0, L.LOW),
        (0.0999, L.LOW),
        (0.10, L.MODERATE),
        (0.2499, L.MODERATE),
        (0.25, L.HIGH),
        (0.4999, L.HIGH),
        (0.50, L.SEVERE),
        (0.75, L.SEVERE),
        # The table states this edge explicitly: No Travel is "> 1.00".
        (1.00, L.SEVERE),
        (1.0001, L.NO_TRAVEL),
        (3.0, L.NO_TRAVEL),
    ],
)
def test_classify_rain(in_h, expected):
    assert classify_rain(in_h) == expected


@pytest.mark.parametrize(
    ("in_h", "expected"),
    [
        (0.0, L.LOW),
        (0.49, L.LOW),
        (0.4999, L.LOW),
        (0.5, L.MODERATE),
        (0.99, L.MODERATE),
        (1.0, L.HIGH),
        (1.99, L.HIGH),
        (2.0, L.SEVERE),
        (2.5, L.SEVERE),
        # Same as rain: No Travel is "> 3.0", so 3.0 itself stays Severe.
        (3.0, L.SEVERE),
        (3.0001, L.NO_TRAVEL),
        (3.01, L.NO_TRAVEL),
    ],
)
def test_classify_snow(in_h, expected):
    assert classify_snow(in_h) == expected


@pytest.mark.parametrize(
    ("weather", "level", "factor"),
    [
        (sample(wind=30), L.MODERATE, "wind"),
        (sample(rain=0.3), L.HIGH, "rain"),
        (sample(snow=1.5), L.HIGH, "snow"),
        (sample(wind=30, rain=0.6), L.SEVERE, "rain"),
        (sample(wind=56, snow=3.5), L.NO_TRAVEL, "wind"),
        # On a tie the label goes to the first factor in wind, rain, snow order.
        (sample(wind=36, rain=0.3, snow=1.2), L.HIGH, "wind"),
        (sample(rain=0.6, snow=2.5), L.SEVERE, "rain"),
    ],
)
def test_factor_names_what_drove_the_level(weather, level, factor):
    result = assess(weather, cargo_lb=0)
    assert (result.level, result.factor) == (level, factor)


def test_point_level_is_worst_factor():
    result = assess(sample(wind=26, rain=0.3, snow=0.6), cargo_lb=0)
    assert result.level == L.HIGH
    assert result.factor == "rain"
    assert result.load_rule is None


def test_snow_can_drive_the_level():
    result = assess(sample(wind=10, snow=2.5), cargo_lb=0)
    assert (result.level, result.factor) == (L.SEVERE, "snow")


def test_calm_weather_is_low_and_attributed_to_wind():
    result = assess(sample(), cargo_lb=80_000)
    assert (result.level, result.factor, result.load_rule) == (L.LOW, "wind", None)


def test_gusts_do_not_affect_risk():
    assert assess(sample(wind=10, gust=70), cargo_lb=80_000).level == L.LOW


@pytest.mark.parametrize(
    ("wind", "cargo", "level", "factor", "rule"),
    [
        # 45-54 mph: the 30,000 lb threshold is strict ("over 30,000").
        (45, 30_000, L.SEVERE, "wind", None),
        (45, 30_001, L.NO_TRAVEL, "load", LOAD_RULE_NO_TRAVEL),
        (54.99, 30_000, L.SEVERE, "wind", None),
        (54.99, 30_001, L.NO_TRAVEL, "load", LOAD_RULE_NO_TRAVEL),
        (44.99, 30_001, L.HIGH, "wind", None),
        # 35-44 mph: the 40,000 lb threshold is strict.
        (35, 40_000, L.HIGH, "wind", None),
        (35, 40_001, L.SEVERE, "load", LOAD_RULE_SEVERE),
        (44.99, 40_000, L.HIGH, "wind", None),
        # Over 30,000 but not over 40,000 lb: the 35-44 mph rule does not apply.
        (40, 35_000, L.HIGH, "wind", None),
        (44.99, 40_001, L.SEVERE, "load", LOAD_RULE_SEVERE),
        (34.99, 80_000, L.MODERATE, "wind", None),
        (45, 80_000, L.NO_TRAVEL, "load", LOAD_RULE_NO_TRAVEL),
        # Below the lower wind edge of each rule, no load can trigger it.
        (24.99, 80_000, L.LOW, "wind", None),
        # 55+ is No Travel from wind alone, whatever the load.
        (55, 0, L.NO_TRAVEL, "wind", None),
        (55, 80_000, L.NO_TRAVEL, "wind", None),
        # 45-54 with a load over 40,000 still lands on the No Travel rule.
        (50, 45_000, L.NO_TRAVEL, "load", LOAD_RULE_NO_TRAVEL),
    ],
)
def test_load_rules(wind, cargo, level, factor, rule):
    result = assess(sample(wind=wind), cargo_lb=cargo)
    assert (result.level, result.factor, result.load_rule) == (level, factor, rule)


def test_load_rule_does_not_override_worse_weather():
    # Rain is already Severe; the wind/load rule would also give Severe, so rain keeps the label.
    result = assess(sample(wind=40, rain=0.6), cargo_lb=50_000)
    assert (result.level, result.factor, result.load_rule) == (L.SEVERE, "rain", None)


def test_rain_no_travel_beats_load_rule():
    result = assess(sample(wind=40, rain=1.2), cargo_lb=50_000)
    assert (result.level, result.factor, result.load_rule) == (L.NO_TRAVEL, "rain", None)


def test_load_rule_raises_above_moderate_rain():
    result = assess(sample(wind=46, rain=0.3), cargo_lb=35_000)
    assert (result.level, result.factor, result.load_rule) == (
        L.NO_TRAVEL,
        "load",
        LOAD_RULE_NO_TRAVEL,
    )
