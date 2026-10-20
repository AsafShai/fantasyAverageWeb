import pytest

from app.services.league_activity_service import GameLine
from app.services.stint_value import StintValuer

CATS = ['PTS', 'REB', 'TO', 'FG%']


def line(period, pts, reb=0.0, to=0.0, fgm=0.0, fga=0.0):
    return GameLine(period=period, game_id=f'g{period}', box={'PTS': pts, 'REB': reb, 'TO': to, 'FGM': fgm, 'FGA': fga})


def pool():
    # Player i scores 10*i points a game in periods 1-5 and nothing after:
    # only the window decides who leads.
    logs = {i: [line(p, 10.0 * i, reb=5.0, to=2.0, fgm=4.0, fga=8.0) for p in range(1, 6)] for i in range(1, 5)}
    logs[9] = [line(p, 50.0, reb=5.0, to=2.0, fgm=4.0, fga=8.0) for p in range(6, 9)]
    return logs


def test_rank_is_against_players_over_the_same_periods():
    v = StintValuer(pool(), CATS, {'TO'}, last_period=8)
    early = v.value(1, 5, 5, {'PTS': 175.0, 'REB': 25.0, 'TO': 10.0, 'FGM': 20.0, 'FGA': 40.0})  # 35 a game
    assert (early.rank, early.of) == (2, 4)  # behind the 40-a-game player only
    late = v.value(6, 8, 3, {'PTS': 105.0, 'REB': 15.0, 'TO': 6.0, 'FGM': 12.0, 'FGA': 24.0})  # 35 a game
    assert (late.rank, late.of) == (1, 1)  # only player 9 played then, and scored less


def test_reverse_category_and_flat_categories():
    v = StintValuer(pool(), CATS, {'TO'}, last_period=8)
    sloppy = v.value(1, 5, 5, {'PTS': 50.0, 'REB': 25.0, 'TO': 50.0, 'FGM': 20.0, 'FGA': 40.0})
    # Everyone in the pool has the same REB and FG%: no spread scores 0, never NaN.
    assert sloppy.cat_z['REB'] == 0 and sloppy.cat_z['FG%'] == 0
    # TO has no spread either; PTS (10 a game) is the worst in the pool.
    assert sloppy.cat_z['PTS'] < 0 and sloppy.cat_rank['PTS'] == 4
    assert sloppy.z == pytest.approx(sloppy.cat_z['PTS'] / len(CATS), abs=0.01)


def test_no_games_or_no_pool_is_unvalued():
    v = StintValuer(pool(), CATS, set(), last_period=8)
    assert v.value(1, 5, 0, {}) is None
    assert v.value(5, 4, 1, {'PTS': 10.0}) is None  # never reached a roster lock
    assert StintValuer({}, CATS, set(), last_period=8).value(1, 5, 1, {'PTS': 10.0}) is None
