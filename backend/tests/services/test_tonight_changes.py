"""Tonight against this morning's official standings (plan section 7 step 4):
Rankings / Today movers, Top 5 deltas, heatmap GP "+N", league averages that
changed, date ranges that end today and the live point on Rankings Over Time."""
from datetime import date, timedelta

import pandas as pd
import pytest

from app.config import settings
from app.services import tonight_changes as tc
from app.services.live_overlay_service import LiveState


def ranks(rows):
    """A rankings frame: (team_id, name, {cat: points}, total, gp)."""
    return pd.DataFrame([
        {'team_id': tid, 'team_name': name, **cats, 'TOTAL_POINTS': total, 'GP': gp}
        for tid, name, cats, total, gp in rows
    ])


OFFICIAL = ranks([
    (1, 'Alpha', {'PTS': 3.0, 'REB': 1.0}, 4.0, 100),
    (2, 'Beta', {'PTS': 2.0, 'REB': 3.0}, 5.0, 101),
    (3, 'Gamma', {'PTS': 1.0, 'REB': 2.0}, 3.0, 99),
])
# Tonight Gamma passes Alpha on REB; Alpha played two games, Gamma one.
LIVE = ranks([
    (1, 'Alpha', {'PTS': 3.0, 'REB': 0.5}, 3.5, 102),
    (2, 'Beta', {'PTS': 2.0, 'REB': 3.0}, 5.0, 101),
    (3, 'Gamma', {'PTS': 1.0, 'REB': 2.5}, 3.5, 100),
])
CATS = ['PTS', 'REB']


class TestRankChanges:
    def test_points_places_and_gp_move_against_this_morning(self):
        changes = tc.rank_changes_between(OFFICIAL, LIVE, CATS, period=24)
        assert changes.previous_period == 23 and changes.latest_period == 24
        by_team = {t.team_id: t for t in changes.teams}
        assert by_team[1].categories == {'PTS': 0.0, 'REB': -0.5}
        assert by_team[1].total_delta == -0.5
        assert by_team[1].gp_delta == 2
        # Alpha 2nd -> tied 2nd, Gamma 3rd -> tied 2nd (competition ranking).
        assert by_team[1].rank_delta == 0
        assert by_team[3].rank_delta == 1
        assert by_team[2].rank_delta == 0 and by_team[2].gp_delta == 0

    def test_identical_frames_mean_no_change(self):
        changes = tc.rank_changes_between(OFFICIAL, OFFICIAL, CATS, period=24)
        assert all(t.total_delta == 0 and t.gp_delta == 0 and t.rank_delta == 0 for t in changes.teams)

    def test_a_category_missing_from_one_frame_is_skipped(self):
        changes = tc.rank_changes_between(OFFICIAL, LIVE.drop(columns=['REB']), CATS, period=24)
        assert all('REB' not in t.categories for t in changes.teams)


class TestMovers:
    def test_only_what_moved_sorted_by_size(self):
        movers = tc.movers_between(OFFICIAL, LIVE, CATS)
        assert [(m.team_name, m.category, m.delta) for m in movers] == [
            ('Alpha', 'REB', -0.5), ('Alpha', 'TOTAL', -0.5),
            ('Gamma', 'REB', 0.5), ('Gamma', 'TOTAL', 0.5),
        ]

    def test_nothing_moved(self):
        assert tc.movers_between(OFFICIAL, OFFICIAL, CATS) == []


def test_gp_tonight_follows_the_given_team_order():
    assert tc.gp_tonight(OFFICIAL, LIVE, [3, 1, 2, 9]) == [1, 2, 0, 0]


class TestRangeReachesTonight:
    def state(self, period, active=True):
        return LiveState(active, period, None, 4, 1, 1, None)

    def test_slate_date_is_the_snapshot_date_of_the_period(self):
        assert tc.slate_date(24) == settings.season_start + timedelta(days=23)

    def test_range_ending_on_or_after_tonight_reaches_it(self):
        tonight = tc.slate_date(24)
        assert tc.range_reaches_tonight(self.state(24), tonight)
        assert tc.range_reaches_tonight(self.state(24), tonight + timedelta(days=1))   # viewer east of the US
        assert not tc.range_reaches_tonight(self.state(24), tonight - timedelta(days=1))

    def test_flag_off_or_no_period_never_reaches(self):
        assert not tc.range_reaches_tonight(None, date(2030, 1, 1))
        assert not tc.range_reaches_tonight(self.state(None), date(2030, 1, 1))


class TestLivePoints:
    def test_rankings_point_carries_points_total_gp_and_the_slate_date(self):
        frame = ranks([(1, 'Alpha', {'FG%': 2.0, 'PTS': 3.0, 'TO': 1.0}, 6.0, 102)])
        [point] = tc.rankings_points(frame, ['FG%', 'PTS', 'TO'], period=24)
        assert point['date'] == tc.slate_date(24)
        assert point['rk_fg_pct'] == 2.0 and point['rk_pts'] == 3.0
        assert point['rk_total'] == 6.0 and point['gp'] == 102
        # A league scoring a category with no rk_* column gets the generic map, as stored rows do.
        assert point['ranks'] == {'FG%': 2.0, 'PTS': 3.0, 'TO': 1.0}

    def test_fixed_category_league_has_no_ranks_map(self):
        frame = ranks([(1, 'Alpha', {'PTS': 3.0}, 3.0, 10)])
        [point] = tc.rankings_points(frame, ['PTS'], period=24)
        assert point['ranks'] is None

    def test_stat_point_rebuilds_ratios_and_divides_per_game(self):
        totals = pd.DataFrame([{
            'team_id': 1, 'team_name': 'Alpha', 'GP': 10, 'FGM': 45, 'FGA': 100, 'FG%': 99.0,
            'FTM': 8, 'FTA': 10, 'FT%': 99.0, '3PM': 20, 'REB': 50, 'AST': 30, 'STL': 10,
            'BLK': 5, 'PTS': 120,
        }])
        [season] = tc.stat_points(totals, period=24, per_game=False)
        assert season['values']['FG%'] == 0.45 and season['values']['PTS'] == 120
        assert season['gp'] == 10 and season['pts'] == 120
        [avg] = tc.stat_points(totals, period=24, per_game=True)
        assert avg['values']['PTS'] == 12.0 and avg['values']['FT%'] == 0.8


def test_range_frames_use_the_live_frame_as_the_end_snapshot():
    """Ending today, the range's end is the live frame itself: ESPN's season
    totals through last night plus tonight, never the DB's latest row plus an
    overlay (which would miss a day whenever the DB sync lags)."""
    from app.services.ranking_service import RankingService
    end_live = pd.DataFrame([{'team_id': 1, 'team_name': 'A', 'GP': 12, 'FGM': 50, 'FGA': 100, 'PTS': 130}])
    start = pd.DataFrame([{'team_id': 1, 'team_name': 'A', 'GP': 10, 'FGM': 40, 'FGA': 80, 'PTS': 100}])
    delta = RankingService()._compute_delta(tc.as_snapshot(end_live), start)
    assert delta.loc[0, 'GP'] == 2 and delta.loc[0, 'PTS'] == 30 and delta.loc[0, 'FGM'] == 10
