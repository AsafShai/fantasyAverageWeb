"""``tonight`` on the team detail: GP and points added tonight, games per
slot and starters playing now (plan section 7 step 3; Team page artboard)."""
import pandas as pd

from app.services.team_service import team_tonight


def _avg(gp):
    return pd.DataFrame({'team_id': [1, 2], 'GP': [gp, 90]})


def _rank(points):
    return pd.DataFrame({'team_id': [1, 2], 'TOTAL_POINTS': [points, 50.0]})


def test_deltas_against_the_official_frames():
    tonight = team_tonight(
        1,
        official=(_avg(102), _rank(39.0)), live=(_avg(104), _rank(36.0)),
        official_slots={'SF': 10, 'F': 9, 'PG': 11}, live_slots={'SF': 11, 'F': 10, 'PG': 11},
        starters_live=2,
    )
    assert tonight.gp == 2
    assert tonight.points == -3.0
    assert tonight.slots == {'SF': 1, 'F': 1}
    assert tonight.starters_live == 2


def test_nothing_tonight_is_all_zero():
    tonight = team_tonight(1, official=(_avg(102), _rank(39.0)), live=(_avg(102), _rank(39.0)),
                           official_slots={'PG': 11}, live_slots={'PG': 11}, starters_live=0)
    assert (tonight.gp, tonight.points, tonight.slots, tonight.starters_live) == (0, 0, {}, 0)


def test_missing_team_or_columns_gives_zero_not_an_error():
    empty = pd.DataFrame({'team_id': []})
    tonight = team_tonight(1, official=(empty, empty), live=(_avg(104), _rank(36.0)),
                           official_slots={}, live_slots={'PG': 1}, starters_live=1)
    assert tonight.gp == 0 and tonight.points == 0 and tonight.slots == {'PG': 1}
