"""Route ranking and the one-line reason behind each rank.

Routes are ordered by exposure to the worst conditions first, then by average risk, then by
time: (no_travel_miles, severe_miles, high_miles, avg_risk, duration_s). Miles are compared at
0.1 mi and average risk at 0.01, the precision the plan shows, so a difference the driver cannot
see never decides the recommendation. Pure: no I/O, no Django.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass

from .types import RiskLevel

# Levels that count against a route, worst first, in key order.
RANKED_LEVELS = (RiskLevel.NO_TRAVEL, RiskLevel.SEVERE, RiskLevel.HIGH)
LEVEL_NAMES = {
    RiskLevel.NO_TRAVEL: "No Travel",
    RiskLevel.SEVERE: "Severe",
    RiskLevel.HIGH: "High",
}

MILES_PRECISION = 1
AVG_RISK_PRECISION = 2

AVG_RISK_INDEX = len(RANKED_LEVELS)
DURATION_INDEX = AVG_RISK_INDEX + 1


@dataclass(frozen=True)
class RouteScore:
    route_id: str
    label: str
    miles: Mapping[RiskLevel, float]
    avg_risk: float
    duration_s: float


@dataclass(frozen=True)
class Ranking:
    route_id: str
    rank: int
    recommended: bool
    reason: str


def ranking_key(score: RouteScore) -> tuple[float, ...]:
    miles = tuple(round(score.miles.get(level, 0.0), MILES_PRECISION) for level in RANKED_LEVELS)
    return (*miles, round(score.avg_risk, AVG_RISK_PRECISION), round(score.duration_s))


def rank_routes(scores: Sequence[RouteScore]) -> list[Ranking]:
    """Best first, ranks 1..n. Routes equal on every criterion are ordered by id."""
    ordered = sorted(scores, key=lambda s: (ranking_key(s), s.route_id))
    if not ordered:
        return []
    best, others = ordered[0], ordered[1:]
    rankings = [Ranking(best.route_id, 1, True, _winning_reason(best, others))]
    rankings += [
        Ranking(score.route_id, rank, False, _trailing_reason(score, best))
        for rank, score in enumerate(others, start=2)
    ]
    return rankings


def first_difference(a: RouteScore, b: RouteScore) -> int | None:
    """Index of the first key criterion on which two routes differ, or None for a full tie."""
    for index, (x, y) in enumerate(zip(ranking_key(a), ranking_key(b), strict=True)):
        if x != y:
            return index
    return None


def _winning_reason(best: RouteScore, others: Sequence[RouteScore]) -> str:
    if not others:
        return "The only route available for this trip."
    runner_up = others[0]
    index = first_difference(best, runner_up)
    if index is None:
        tied = [o for o in others if first_difference(best, o) is None]
        rivals = tied[0].label if len(tied) == 1 else "the other routes"
        return f"Same risk and time as {rivals}; listed first by name."
    if index < AVG_RISK_INDEX:
        return _fewer_miles_reason(best, others, RANKED_LEVELS[index])
    if index == AVG_RISK_INDEX:
        lead = (
            "No miles at High risk or worse"
            if _is_clear(best)
            else f"Same miles at High risk or worse as {runner_up.label}"
        )
        return (
            f"{lead} and a lower average risk "
            f"({_avg(best)} vs {_avg(runner_up)} for {runner_up.label})."
        )
    gap = _duration(runner_up.duration_s - best.duration_s)
    tied_on_risk = all(first_difference(best, o) in (DURATION_INDEX, None) for o in others)
    if tied_on_risk and len(others) > 1:
        return f"Same risk as the other routes and the fastest, {gap} ahead of {runner_up.label}."
    return f"Same risk as {runner_up.label} and {gap} faster."


def _fewer_miles_reason(best: RouteScore, others: Sequence[RouteScore], level: RiskLevel) -> str:
    # Each claim is checked against every route, not just the runner-up: a route further down
    # can have fewer miles at this level and lose on a worse one.
    if _is_clear(best):
        return "The only route with no miles at High risk or worse."
    mine = _miles(best, level)
    theirs = [_miles(o, level) for o in others]
    name = LEVEL_NAMES[level]
    if mine == 0 and all(m > 0 for m in theirs):
        return f"The only route that avoids {name} risk."
    if len(others) > 1 and all(m > mine for m in theirs):
        return f"Fewest miles in {name} risk of the {len(others) + 1} routes ({_mi(mine)} mi)."
    runner_up = others[0]
    fewer = _miles_phrase(_miles(runner_up, level) - mine, "fewer")
    return f"{fewer} in {name} risk than {runner_up.label}."


def _trailing_reason(score: RouteScore, best: RouteScore) -> str:
    index = first_difference(score, best)
    if index is None:
        return f"Same risk and time as {best.label}, which is listed first by name."
    if index < AVG_RISK_INDEX:
        level = RANKED_LEVELS[index]
        more = _miles_phrase(_miles(score, level) - _miles(best, level), "more")
        return f"{more} in {LEVEL_NAMES[level]} risk than {best.label}."
    if index == AVG_RISK_INDEX:
        return f"Higher average risk than {best.label} ({_avg(score)} vs {_avg(best)})."
    return f"Same risk as {best.label} but {_duration(score.duration_s - best.duration_s)} longer."


def _is_clear(score: RouteScore) -> bool:
    return all(_miles(score, level) == 0 for level in RANKED_LEVELS)


def _miles(score: RouteScore, level: RiskLevel) -> float:
    return round(score.miles.get(level, 0.0), MILES_PRECISION)


def _mi(miles: float) -> str:
    return f"{miles:,.1f}".removesuffix(".0")


def _miles_phrase(diff: float, comparative: str) -> str:
    # Both sides are already rounded; rounding the difference strips float noise (10.3 - 10.2).
    text = _mi(round(diff, MILES_PRECISION))
    return f"{text} {comparative} {'mile' if text == '1' else 'miles'}"


def _avg(score: RouteScore) -> str:
    return f"{round(score.avg_risk, AVG_RISK_PRECISION):.2f}"


def _duration(seconds: float) -> str:
    minutes = round(seconds / 60)
    if minutes < 1:
        return "under a minute"
    if minutes < 60:
        return f"{minutes} min"
    hours, rest = divmod(minutes, 60)
    return f"{hours} h {rest:02d} min" if rest else f"{hours} h"
