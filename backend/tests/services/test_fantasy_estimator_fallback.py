from datetime import date, datetime, timedelta

import numpy as np
import pandas as pd
import pytest

from app.fantsy_estimator import FantasyEstimator
from app.utils.roster_slots import SLOT_CAPS

SEASON_CAP = float(sum(SLOT_CAPS.values()))


def make_snapshot(team_id: int, days: int, games_per_day: int = 6) -> pd.DataFrame:
    """Cumulative daily totals for one team, with a little noise so the covariance is not zero."""
    rng = np.random.default_rng(team_id)
    rows, totals = [], dict.fromkeys(['gp', 'fgm', 'fga', 'ftm', 'fta', 'three_pm', 'reb', 'ast', 'stl', 'blk', 'pts'], 0.0)
    for day in range(1, days + 1):
        g = games_per_day
        fga = g * 15 + rng.normal(0, 3)
        fta = g * 4 + rng.normal(0, 1)
        day_stats = {
            'gp': g, 'fga': fga, 'fgm': fga * 0.47, 'fta': fta, 'ftm': fta * 0.78,
            'three_pm': g * 2 + rng.normal(0, 1), 'reb': g * 7 + rng.normal(0, 2),
            'ast': g * 4 + rng.normal(0, 1), 'stl': g + rng.normal(0, 0.3),
            'blk': g * 0.8 + rng.normal(0, 0.3), 'pts': g * 18 + rng.normal(0, 4),
        }
        for k, v in day_stats.items():
            totals[k] += v
        rows.append({
            'id': len(rows), 'scoring_period_id': day, 'date': date(2026, 10, 20) + timedelta(days=day),
            'team_id': team_id, 'team_name': f'Team {team_id}',
            'fg_pct': totals['fgm'] / totals['fga'], 'ft_pct': totals['ftm'] / totals['fta'],
            'created_at': datetime(2026, 10, 21), **totals,
        })
    return pd.DataFrame(rows)


class TestFallbackTotalGp:
    def test_stretches_games_so_far_to_a_full_season(self):
        # Mid-season, 400 games played: a full season is 800 games, not the 411 an
        # on-pace team has played by today.
        assert FantasyEstimator._fallback_total_gp(400, 41, SEASON_CAP) == pytest.approx(800)

    def test_caps_at_the_season_limit(self):
        assert FantasyEstimator._fallback_total_gp(450, 41, SEASON_CAP) == SEASON_CAP

    def test_zero_pace_assumes_the_season_cap(self):
        assert FantasyEstimator._fallback_total_gp(0, 0, SEASON_CAP) == SEASON_CAP


class TestEstimateWithoutSlotData:
    @pytest.mark.parametrize('slot_proj_df', [None, pd.DataFrame()])
    def test_teams_still_have_games_to_come(self, slot_proj_df):
        """Edge case: slot usage came back empty. Every team falls back, and must
        still be projected forward instead of frozen at today's totals."""
        df = pd.concat([make_snapshot(1, 30), make_snapshot(2, 30)], ignore_index=True)
        nba_avg_pace = 30.0

        predictions, ranking, _ = FantasyEstimator().estimate(df, nba_avg_pace, slot_proj_df)

        gp_now = 30 * 6
        expected_total = gp_now * 82 / nba_avg_pace  # 492, under the 822 cap
        assert list(predictions['projected_total_gp']) == pytest.approx([expected_total] * 2)
        # Projected season points well beyond today's totals.
        pts_now = df.groupby('team_id')['pts'].last()
        for _, row in predictions.iterrows():
            assert row['estimated_final_pts'] > pts_now[row['team_id']] * 2
        assert len(ranking) == 2

    def test_team_missing_from_slot_data_falls_back(self):
        df = pd.concat([make_snapshot(1, 30), make_snapshot(2, 30)], ignore_index=True)
        slot_proj_df = pd.DataFrame([{'team_id': 1, 'team_name': 'Team 1', 'proj_total': 700.0}])

        predictions, _, _ = FantasyEstimator().estimate(df, 30.0, slot_proj_df)

        by_team = predictions.set_index('team_id')['projected_total_gp']
        assert by_team[1] == pytest.approx(700.0)
        assert by_team[2] == pytest.approx(180 * 82 / 30.0)


class TestPeriodsPlayed:
    @pytest.mark.parametrize('days', [1, 8, 11, 12, 13])
    def test_counts_game_days_the_way_estimate_skips_teams(self, days):
        """A team is estimated exactly when its game-day count reaches
        periods_needed, so the warm-up message can't disagree with the run."""
        df = pd.concat([make_snapshot(1, days), make_snapshot(2, max(days - 3, 1))], ignore_index=True)
        estimator = FantasyEstimator()
        played = estimator.periods_played(df)
        predictions, _, _ = estimator.estimate(df, 30.0, None)
        assert (played >= estimator.periods_needed) == (not predictions.empty)
        assert played == estimator.periods_played(make_snapshot(1, days))    # the furthest team counts

