from datetime import date

import numpy as np
import pandas as pd
import pytest

from app.services import model_accuracy_metrics as m


def _row(**over) -> dict:
    """One graded pre-game row: projection, last-10 baseline and box score."""
    row = {
        'game_date': date(2026, 12, 8), 'player_id': 1, 'player_name': 'Cade Cunningham',
        'team_id': 8, 'opponent_team_id': 18, 'is_home': True, 'outcome': 'played',
        'injury_status': None, 'proj_min': 34.0, 'base_min': 33.0, 'actual_min': 34.0,
        'actual_pf': 2.0, 'team_margin': 4.0, 'pred_fg_pct': 0.45, 'pred_ft_pct': 0.85,
    }
    for s in m.STATS:
        row[f'pred_{s}'] = 5.0
        row[f'base_{s}'] = 5.0
        row[f'actual_{s}'] = 5.0
    row.update(over)
    return row


def _df(*rows) -> pd.DataFrame:
    return pd.DataFrame(list(rows))


def test_window_bounds_anchor_on_latest_data_date():
    latest = date(2026, 12, 10)  # a Thursday
    assert m.window_bounds('week', latest) == (date(2026, 12, 7), latest)
    assert m.window_bounds('d30', latest) == (date(2026, 11, 11), latest)
    assert m.window_bounds('season', latest) == (date(2026, 8, 1), latest)
    assert m.window_bounds('season', date(2027, 3, 1))[0] == date(2026, 8, 1)


def test_error_stats_compares_model_and_baseline_on_the_same_games():
    df = _df(
        _row(pred_pts=20.0, base_pts=16.0, actual_pts=22.0),
        _row(pred_pts=10.0, base_pts=12.0, actual_pts=17.0),
        # No baseline (no stored history): excluded from BOTH sides.
        _row(pred_pts=30.0, base_pts=np.nan, actual_pts=0.0),
    )
    s = m.error_stats(df, 'pts', 4)
    assert s['games'] == 2
    assert s['model_mae'] == pytest.approx((2 + 7) / 2)
    assert s['baseline_mae'] == pytest.approx((6 + 5) / 2)
    assert s['hit_rate'] == pytest.approx(0.5)


def test_fg_pct_only_counts_games_with_enough_attempts():
    df = _df(
        _row(actual_fgm=5.0, actual_fga=10.0, pred_fg_pct=0.40, base_fgm=4.0, base_fga=8.0),
        _row(actual_fgm=0.0, actual_fga=2.0, pred_fg_pct=0.40),  # 2 FGA: noise, skipped
    )
    s = m.error_stats(df, 'fg_pct', 10)
    assert s['games'] == 1
    assert s['model_mae'] == pytest.approx(10.0)
    assert s['baseline_mae'] == pytest.approx(0.0)


def test_category_summary_ignores_dnps():
    df = _df(_row(), _row(outcome='dnp', actual_pts=0.0))
    pts = next(c for c in m.category_summary(df) if c['key'] == 'pts')
    assert pts['games'] == 1 and pts['model_mae'] == 0


def test_weekly_groups_by_monday():
    df = _df(_row(game_date=date(2026, 12, 7)), _row(game_date=date(2026, 12, 13)), _row(game_date=date(2026, 12, 14)))
    weeks = m.weekly(df)
    assert [(w['week_start'], w['games']) for w in weeks] == [('2026-12-07', 2), ('2026-12-14', 1)]
    assert set(weeks[0]['categories']) == {k for k, _, _ in m.CATEGORIES}


def test_composite_sign_and_dnp_counts_as_zeros():
    df = _df(_row(actual_pts=11.5), _row(outcome='dnp', **{f'actual_{s}': np.nan for s in m.STATS}))
    z = m.composite(df)
    assert z.iloc[0] == pytest.approx(6.5 / 6.5)
    assert z.iloc[1] == pytest.approx(-sum(5.0 / m.Z_SCALE[s] for s in m.COUNTING))


@pytest.mark.parametrize('zs,flag', [
    ([1, 1, 1, 1, 1, -1, -1, -1], 'flat'),  # 5 up but average only 0.25
    ([1, 1, 1, 1, 2, -1, -1, -1], 'flat'),
    ([1, 1, 1, 2, 2, -1, -1, 1], 'up'),
    ([-1, -1, -2, -1, -1, 1, 0.5, -1], 'down'),
    ([], 'flat'),
])
def test_flag_for(zs, flag):
    assert m.flag_for(zs) == flag


@pytest.mark.parametrize('over,label', [
    ({'outcome': 'dnp', 'injury_status': 'Questionable'}, 'DNP'),
    ({'actual_min': 22.0, 'team_margin': 31.0}, 'Blowout'),
    ({'actual_min': 22.0, 'team_margin': -25.0}, 'Blowout'),
    ({'actual_min': 17.0, 'actual_pf': 5.0}, 'Foul trouble'),
    ({'actual_min': 44.0}, 'Minutes gap'),
    ({'actual_min': 24.0}, 'Minutes gap'),
    ({'actual_fgm': 9.0, 'actual_fga': 10.0}, 'Shooting variance'),
    ({'actual_fg3m': 9.0}, 'Shooting variance'),
    ({'actual_fgm': 4.5, 'actual_fga': 10.0}, 'No clear cause'),
])
def test_miss_reason(over, label):
    assert m.miss_reason(_row(**over))[0] == label


def test_miss_reason_dnp_detail_names_snapshot_injury_status():
    assert m.miss_reason(_row(outcome='dnp', injury_status='Questionable'))[1] == 'Projected 34 min; listed Questionable at snapshot'
    assert 'not on the injury report' in m.miss_reason(_row(outcome='dnp'))[1]
    assert 'not on the injury report' in m.miss_reason(_row(outcome='dnp', injury_status=float('nan')))[1]


def test_biggest_misses_ranked_by_absolute_composite_among_played_games():
    df = _df(
        _row(player_id=1, player_name='Small', actual_pts=7.0),
        _row(player_id=2, player_name='Big Over', actual_pts=30.0, actual_min=44.0),
        _row(player_id=4, player_name='Big Under', actual_pts=0.0, actual_reb=0.0, actual_min=10.0),
        # A DNP would zero every category and top the list; it goes to didnt_play.
        _row(player_id=3, player_name='Sat Out', outcome='dnp', **{f'actual_{s}': np.nan for s in m.STATS}),
    )
    out = m.biggest_misses(df, limit=2)
    assert [x['player_name'] for x in out] == ['Big Over', 'Big Under']
    assert out[0]['z'] > 0 > out[1]['z']
    assert out[0]['line'][0] == {'stat': 'MIN', 'proj': 34.0, 'actual': 44.0}
    assert out[0]['line'][1]['stat'] == 'PTS'
    assert out[1]['reason'] == 'Minutes gap'
    assert out[0]['team'] == 'DET' and out[0]['opponent'] == 'NYK'


def test_didnt_play_lists_dnps_by_projected_minutes():
    df = _df(
        _row(player_id=1, player_name='Bench', outcome='dnp', proj_min=12.0),
        _row(player_id=2, player_name='Starter', outcome='dnp', proj_min=36.0, injury_status='Questionable'),
        _row(player_id=3, player_name='Played'),
    )
    out = m.didnt_play(df)
    assert [x['player_name'] for x in out] == ['Starter', 'Bench']
    assert out[0]['injury_status'] == 'Questionable' and out[1]['injury_status'] is None
    assert m.didnt_play(df.iloc[[2]]) == []


def test_player_rows_skip_dnps_in_strip_and_need_min_games():
    rows = [
        _row(player_id=1, game_date=date(2026, 12, d), actual_pts=15.0) for d in range(1, 7)
    ] + [
        _row(player_id=1, game_date=date(2026, 12, 7), outcome='dnp', **{f'actual_{s}': np.nan for s in m.STATS}),
        _row(player_id=2, player_name='Thin', game_date=date(2026, 12, 1)),
    ]
    out = m.player_rows(_df(*rows))
    assert [p['player_id'] for p in out] == [1]
    p = out[0]
    assert len(p['games']) == 6 and p['dnp'] == 1
    assert p['flag'] == 'up'
    assert p['proj_pts'] == 5.0 and p['actual_pts'] == 15.0


def test_player_detail_uses_volume_weighted_shooting():
    df = _df(
        _row(game_date=date(2026, 12, 1), actual_fgm=2.0, actual_fga=10.0),
        _row(game_date=date(2026, 12, 2), actual_fgm=8.0, actual_fga=10.0),
    )
    d = m.player_detail(df)
    fg = next(c for c in d['categories'] if c['key'] == 'fg_pct')
    assert fg == {'key': 'fg_pct', 'label': 'FG%', 'proj': 45.0, 'actual': 50.0}
    assert d['beat_count'] == 0 and d['flag'] == 'flat'


def test_retro_frame_baseline_is_prior_per_minute_rate_times_actual_minutes():
    fs = pd.DataFrame([
        {'player_id': 1, 'game_id': 'g1', 'game_date': date(2026, 12, 1), 'min': 20.0, **{s: 0.0 for s in m.STATS}, 'pts': 10.0},
        {'player_id': 1, 'game_id': 'g2', 'game_date': date(2026, 12, 2), 'min': 30.0, **{s: 0.0 for s in m.STATS}, 'pts': 30.0},
        # The graded game itself must not feed its own baseline.
        {'player_id': 1, 'game_id': 'g3', 'game_date': date(2026, 12, 3), 'min': 40.0, **{s: 0.0 for s in m.STATS}, 'pts': 99.0},
    ])
    evals = pd.DataFrame([{
        'player_id': 1, 'game_id': 'g3', 'game_date': date(2026, 12, 3), 'minutes': 40.0,
        **{f'pred_{s}': 4.0 for s in m.STATS}, **{f'actual_{s}': 0.0 for s in m.STATS},
    }])
    out = m.retro_frame(evals, fs)
    assert out['base_pts'].iloc[0] == pytest.approx(40 / 50 * 40)
    assert out['pred_fg_pct'].iloc[0] == pytest.approx(1.0)
    assert out['outcome'].iloc[0] == 'played'
