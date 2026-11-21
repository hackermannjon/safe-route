import pytest

from routing_api.services.recommend import RouteScore, rank_routes, ranking_key
from routing_api.services.types import RiskLevel

L = RiskLevel
CLEAR = "The only route with no miles at High risk or worse."


def score(route_id, *, nt=0.0, severe=0.0, high=0.0, avg=0.0, duration=36_000.0):
    return RouteScore(
        route_id=route_id,
        label=f"Route {route_id}",
        miles={L.LOW: 500.0, L.NO_TRAVEL: nt, L.SEVERE: severe, L.HIGH: high},
        avg_risk=avg,
        duration_s=duration,
    )


def ranked(*scores):
    return {r.route_id: r for r in rank_routes(scores)}


def order(*scores):
    return [r.route_id for r in rank_routes(scores)]


def test_no_routes_no_rankings():
    assert rank_routes([]) == []


def test_a_single_route_is_recommended():
    (only,) = rank_routes([score("A", high=40, avg=1.2)])
    assert (only.route_id, only.rank, only.recommended) == ("A", 1, True)
    assert only.reason == "The only route available for this trip."


def test_rankings_come_best_first_with_exactly_one_recommendation():
    rankings = rank_routes([score("A", high=20), score("B"), score("C", severe=1)])
    assert [r.route_id for r in rankings] == ["B", "A", "C"]
    assert [r.rank for r in rankings] == [1, 2, 3]
    assert [r.recommended for r in rankings] == [True, False, False]


def test_the_key_uses_only_the_ranked_levels_in_order():
    assert ranking_key(score("A", nt=1.26, severe=2.04, high=3.0, avg=0.456, duration=99.6)) == (
        1.3,
        2.0,
        3.0,
        0.46,
        100,
    )


@pytest.mark.parametrize(
    ("worse", "better", "reason"),
    [
        # Any No Travel loses to any amount of Severe, High or average risk.
        (
            {"nt": 0.2},
            {"severe": 300, "high": 200, "avg": 2.5},
            "0.2 more miles in No Travel risk than Route B.",
        ),
        (
            {"severe": 5, "avg": 0.1},
            {"high": 90, "avg": 1.4},
            "5 more miles in Severe risk than Route B.",
        ),
        ({"high": 30.3}, {"high": 18.3, "avg": 1.9}, "12 more miles in High risk than Route B."),
        (
            {"avg": 0.42},
            {"avg": 0.18, "duration": 99_999},
            "Higher average risk than Route B (0.42 vs 0.18).",
        ),
        ({"duration": 40_000}, {"duration": 37_720}, "Same risk as Route B but 38 min longer."),
    ],
    ids=["no-travel", "severe", "high", "avg-risk", "duration"],
)
def test_each_criterion_decides_when_the_ones_before_it_tie(worse, better, reason):
    # A is the faster route unless a case says otherwise, so time never explains the order.
    rankings = ranked(score("A", **{"duration": 30_000, **worse}), score("B", **better))
    assert (rankings["B"].rank, rankings["A"].rank) == (1, 2)
    assert rankings["A"].reason == reason


def test_a_mile_is_singular():
    assert (
        ranked(score("A", high=1), score("B"))["A"].reason
        == "1 more mile in High risk than Route B."
    )


def test_large_mileage_differences_read_with_separators():
    rankings = ranked(score("A", high=1_250.5), score("B", high=10))
    assert rankings["A"].reason == "1,240.5 more miles in High risk than Route B."


def test_differences_carry_no_float_noise():
    rankings = ranked(score("A", high=10.3), score("B", high=10.2))
    assert rankings["A"].reason == "0.1 more miles in High risk than Route B."


def test_a_0_04_mile_difference_is_a_tie_and_time_decides():
    # 10.00 and 10.04 both show as 10.0 mi, so the slower route cannot win on them.
    rankings = ranked(score("A", high=10.04, duration=100), score("B", high=10.0, duration=200))
    assert rankings["A"].recommended
    assert rankings["B"].reason == "Same risk as Route A but 2 min longer."


def test_miles_are_rounded_not_compared_within_a_tolerance():
    # 10.04 shows as 10.0 and 10.06 as 10.1: what the driver reads is what is compared.
    rankings = ranked(score("A", high=10.06, duration=100), score("B", high=10.04, duration=200))
    assert rankings["B"].recommended
    assert rankings["A"].reason == "0.1 more miles in High risk than Route B."


def test_average_risk_is_compared_at_two_decimals():
    rankings = ranked(score("A", avg=0.304, duration=10), score("B", avg=0.296, duration=20))
    assert rankings["A"].recommended
    assert rankings["B"].reason == "Same risk as Route A but under a minute longer."


def test_full_tie_is_ordered_by_id_whatever_the_input_order():
    assert order(score("C"), score("A"), score("B")) == ["A", "B", "C"]
    rankings = ranked(score("C"), score("A"), score("B"))
    assert rankings["A"].reason == "Same risk and time as the other routes; listed first by name."
    assert rankings["B"].reason == "Same risk and time as Route A, which is listed first by name."
    assert rankings["C"].reason == "Same risk and time as Route A, which is listed first by name."


def test_a_two_way_tie_names_the_tied_route():
    rankings = ranked(score("B"), score("A"), score("C", high=3))
    assert rankings["A"].reason == "Same risk and time as Route B; listed first by name."
    assert rankings["C"].reason == "3 more miles in High risk than Route A."


class TestWinningReason:
    def test_clear_route(self):
        assert ranked(score("A", high=12), score("B"), score("C", nt=4))["B"].reason == CLEAR

    def test_clear_wording_holds_when_the_runner_up_only_has_no_travel(self):
        rankings = ranked(score("A"), score("B", nt=10))
        assert rankings["A"].reason == CLEAR
        assert rankings["B"].reason == "10 more miles in No Travel risk than Route A."

    def test_the_only_route_avoiding_a_level(self):
        rankings = ranked(score("A", nt=2, high=5), score("B", high=50), score("C", nt=1))
        assert rankings["B"].reason == "The only route that avoids No Travel risk."

    def test_fewest_miles_of_all_routes(self):
        rankings = ranked(score("A", high=30), score("B", high=12), score("C", high=45))
        assert rankings["B"].reason == "Fewest miles in High risk of the 3 routes (12 mi)."

    def test_a_route_further_down_with_fewer_miles_at_that_level_limits_the_claim(self):
        # C has less High than B but loses on Severe, so B cannot claim the fewest High miles.
        rankings = ranked(score("A", high=30), score("B", high=12), score("C", severe=2, high=1))
        assert [rankings[i].rank for i in "BAC"] == [1, 2, 3]
        assert rankings["B"].reason == "18 fewer miles in High risk than Route A."

    def test_two_routes_compare_with_the_other_one(self):
        rankings = ranked(score("A", severe=7.5), score("B", severe=2))
        assert rankings["B"].reason == "5.5 fewer miles in Severe risk than Route A."

    def test_lower_average_risk_on_a_clear_route(self):
        rankings = ranked(score("A", avg=0.42), score("B", avg=0.18))
        assert rankings["B"].reason == (
            "No miles at High risk or worse and a lower average risk (0.18 vs 0.42 for Route A)."
        )

    def test_lower_average_risk_with_equal_high_miles(self):
        rankings = ranked(score("A", high=20, avg=0.7), score("B", high=20, avg=0.65))
        assert rankings["B"].reason == (
            "Same miles at High risk or worse as Route A and a lower average risk "
            "(0.65 vs 0.70 for Route A)."
        )

    def test_fastest_when_every_route_has_the_same_risk(self):
        rankings = ranked(
            score("A", avg=0.2, duration=40_000),
            score("B", avg=0.2, duration=37_720),
            score("C", avg=0.2, duration=45_000),
        )
        assert rankings["B"].reason == (
            "Same risk as the other routes and the fastest, 38 min ahead of Route A."
        )
        assert rankings["C"].reason == "Same risk as Route B but 2 h 01 min longer."

    def test_faster_than_the_runner_up_only(self):
        rankings = ranked(
            score("A", high=4, duration=10_000 + 3_900),
            score("B", high=4, duration=10_000),
            score("C", high=9, duration=9_000),
        )
        assert rankings["B"].reason == "Same risk as Route A and 1 h 05 min faster."
        assert rankings["A"].reason == "Same risk as Route B but 1 h 05 min longer."
        assert rankings["C"].reason == "5 more miles in High risk than Route B."

    def test_whole_hours(self):
        rankings = ranked(score("A", duration=7_200), score("B", duration=14_400))
        assert rankings["A"].reason == "Same risk as Route B and 2 h faster."


def test_the_fastest_route_loses_when_it_is_riskier():
    fastest = score("A", high=25, avg=0.5, duration=30_000)
    safer = score("B", avg=0.1, duration=34_000)
    rankings = ranked(fastest, safer)
    assert rankings["B"].recommended
    assert rankings["A"].reason == "25 more miles in High risk than Route B."
