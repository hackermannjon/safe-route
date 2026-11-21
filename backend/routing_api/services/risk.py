"""Weather risk classification for a loaded truck.

The source table has touching band edges (e.g. wind "25-35" and "35-45"). A value that
sits exactly on a shared edge is put in the higher band, which is the conservative reading
for a safety rule. The only exceptions are the rain and snow SEVERE bands, whose upper edge
the table states explicitly ("> 1.00" and "> 3.0" for No Travel), so those edges stay SEVERE.
"""

from __future__ import annotations

from .types import RiskAssessment, RiskFactor, RiskLevel, WeatherSample

# Sustained wind, mph. Each value is the lower bound (inclusive) of the next level.
WIND_MODERATE_MPH = 25.0
WIND_HIGH_MPH = 35.0
WIND_SEVERE_MPH = 45.0
WIND_NO_TRAVEL_MPH = 55.0

# Rain, in/h. Lower bounds are inclusive; No Travel starts strictly above RAIN_SEVERE_MAX.
RAIN_MODERATE_IN_H = 0.10
RAIN_HIGH_IN_H = 0.25
RAIN_SEVERE_IN_H = 0.50
RAIN_SEVERE_MAX_IN_H = 1.00

# Snowfall, in/h. Same shape as rain.
SNOW_MODERATE_IN_H = 0.5
SNOW_HIGH_IN_H = 1.0
SNOW_SEVERE_IN_H = 2.0
SNOW_SEVERE_MAX_IN_H = 3.0

# Cargo above these weights turns strong wind into a rollover / jackknife hazard.
LOAD_NO_TRAVEL_OVER_LB = 30_000
LOAD_SEVERE_OVER_LB = 40_000

LOAD_RULE_NO_TRAVEL = "Wind 45 to under 55 mph with cargo over 30,000 lb"
LOAD_RULE_SEVERE = "Wind 35 to under 45 mph with cargo over 40,000 lb"


def classify_wind(mph: float) -> RiskLevel:
    if mph >= WIND_NO_TRAVEL_MPH:
        return RiskLevel.NO_TRAVEL
    if mph >= WIND_SEVERE_MPH:
        return RiskLevel.SEVERE
    if mph >= WIND_HIGH_MPH:
        return RiskLevel.HIGH
    if mph >= WIND_MODERATE_MPH:
        return RiskLevel.MODERATE
    return RiskLevel.LOW


def classify_rain(in_h: float) -> RiskLevel:
    if in_h > RAIN_SEVERE_MAX_IN_H:
        return RiskLevel.NO_TRAVEL
    if in_h >= RAIN_SEVERE_IN_H:
        return RiskLevel.SEVERE
    if in_h >= RAIN_HIGH_IN_H:
        return RiskLevel.HIGH
    if in_h >= RAIN_MODERATE_IN_H:
        return RiskLevel.MODERATE
    return RiskLevel.LOW


def classify_snow(in_h: float) -> RiskLevel:
    if in_h > SNOW_SEVERE_MAX_IN_H:
        return RiskLevel.NO_TRAVEL
    if in_h >= SNOW_SEVERE_IN_H:
        return RiskLevel.SEVERE
    if in_h >= SNOW_HIGH_IN_H:
        return RiskLevel.HIGH
    if in_h >= SNOW_MODERATE_IN_H:
        return RiskLevel.MODERATE
    return RiskLevel.LOW


def load_rule_level(wind_mph: float, cargo_lb: float) -> tuple[RiskLevel, str | None]:
    """Minimum level imposed by wind on this cargo weight, with the rule that imposed it.

    Wind at or above 55 mph is already No Travel by itself, so it never needs a load rule.
    """
    if WIND_SEVERE_MPH <= wind_mph < WIND_NO_TRAVEL_MPH and cargo_lb > LOAD_NO_TRAVEL_OVER_LB:
        return RiskLevel.NO_TRAVEL, LOAD_RULE_NO_TRAVEL
    if WIND_HIGH_MPH <= wind_mph < WIND_SEVERE_MPH and cargo_lb > LOAD_SEVERE_OVER_LB:
        return RiskLevel.SEVERE, LOAD_RULE_SEVERE
    return RiskLevel.LOW, None


def assess(weather: WeatherSample, cargo_lb: float) -> RiskAssessment:
    # Order matters only for ties: the first factor listed wins the label.
    factors: tuple[tuple[RiskFactor, RiskLevel], ...] = (
        ("wind", classify_wind(weather.wind_mph)),
        ("rain", classify_rain(weather.rain_in_h)),
        ("snow", classify_snow(weather.snow_in_h)),
    )
    factor, level = max(factors, key=lambda item: item[1])

    load_level, load_rule = load_rule_level(weather.wind_mph, cargo_lb)
    if load_level > level:
        return RiskAssessment(level=load_level, factor="load", load_rule=load_rule)
    return RiskAssessment(level=level, factor=factor)
