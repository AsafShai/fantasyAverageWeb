import pytest
import pandas as pd
from app.services.slot_games_estimator import SlotGamesEstimator, SLOT_CAPS, SLOTS


def make_df(avg_pace: float, days_remaining: int, slot_values: dict | None = None) -> pd.DataFrame:
    slots = slot_values or {s: 40 for s in SLOTS}
    return pd.DataFrame([{
        'team_id': 1,
        'team_name': 'Test Team',
        'nba_avg_pace': avg_pace,
        'nba_game_days_remaining': days_remaining,
        **slots,
    }])


def make_multi_team_df(avg_pace: float, days_remaining: int, teams: list[dict]) -> pd.DataFrame:
    rows = []
    for t in teams:
        rows.append({
            'nba_avg_pace': avg_pace,
            'nba_game_days_remaining': days_remaining,
            **t,
        })
    return pd.DataFrame(rows)


@pytest.fixture
def estimator():
    return SlotGamesEstimator()


class TestSlotGamesEstimatorEarlySeason:
    def test_early_season_weight_favors_method1(self, estimator):
        avg_pace = 10.0
        days_remaining = 100
        gp = 10

        df = make_df(avg_pace, days_remaining, {s: gp for s in SLOTS})
        result = estimator.estimate(df)

        w1 = 1 - avg_pace / 82
        w2 = avg_pace / 82
        m1 = gp * (82 / avg_pace)
        m2 = gp + (gp / avg_pace) * days_remaining
        expected_pg = w1 * m1 + w2 * m2

        assert result['proj_PG'].iloc[0] == pytest.approx(expected_pg, rel=1e-6)

    def test_early_season_w1_dominates(self, estimator):
        df = make_df(avg_pace=5.0, days_remaining=120, slot_values={s: 5 for s in SLOTS})
        result = estimator.estimate(df)

        w2 = 5.0 / 82
        assert w2 < 0.1

        m1_pg = min(5 * (82 / 5.0), SLOT_CAPS['PG'])
        assert result['proj_PG'].iloc[0] == pytest.approx(m1_pg, rel=0.15)


class TestSlotGamesEstimatorLateSeason:
    def test_late_season_weight_favors_method2(self, estimator):
        avg_pace = 78.0
        days_remaining = 5
        gp = 78

        df = make_df(avg_pace, days_remaining, {s: gp for s in SLOTS})
        result = estimator.estimate(df)

        w1 = 1 - avg_pace / 82
        w2 = avg_pace / 82
        m1 = min(gp * (82 / avg_pace), SLOT_CAPS['PG'])
        m2 = min(gp + (gp / avg_pace) * days_remaining, SLOT_CAPS['PG'])
        expected_pg = w1 * m1 + w2 * m2

        assert result['proj_PG'].iloc[0] == pytest.approx(expected_pg, rel=1e-6)

    def test_late_season_w2_dominates(self, estimator):
        df = make_df(avg_pace=80.0, days_remaining=3, slot_values={s: 80 for s in SLOTS})
        result = estimator.estimate(df)

        w2 = 80.0 / 82
        assert w2 > 0.9

        m2_pg = min(80 + (80 / 80.0) * 3, SLOT_CAPS['PG'])
        assert result['proj_PG'].iloc[0] == pytest.approx(m2_pg, rel=0.15)


class TestSlotGamesEstimatorCapEnforcement:
    def test_no_slot_exceeds_cap(self, estimator):
        df = make_df(avg_pace=41.0, days_remaining=60, slot_values={s: SLOT_CAPS[s] for s in SLOTS})
        result = estimator.estimate(df)

        for slot in SLOTS:
            assert result[f'proj_{slot}'].iloc[0] <= SLOT_CAPS[slot] + 1e-9

    def test_util_cap_is_248(self, estimator):
        df = make_df(avg_pace=41.0, days_remaining=60, slot_values={s: SLOT_CAPS[s] for s in SLOTS})
        result = estimator.estimate(df)

        assert result['proj_UTIL'].iloc[0] <= 248 + 1e-9

    def test_slot_at_cap_projects_to_cap(self, estimator):
        df = make_df(avg_pace=41.0, days_remaining=50, slot_values={**{s: 0 for s in SLOTS}, 'PG': 82})
        result = estimator.estimate(df)

        assert result['proj_PG'].iloc[0] == pytest.approx(82.0, rel=1e-6)

    def test_regular_slots_cap_at_82(self, estimator):
        for slot in [s for s in SLOTS if s != 'UTIL']:
            assert SLOT_CAPS[slot] == 82


class TestSlotGamesEstimatorProjTotal:
    def test_proj_total_equals_sum_of_slots(self, estimator):
        df = make_df(avg_pace=41.0, days_remaining=40)
        result = estimator.estimate(df)

        slot_sum = sum(result[f'proj_{s}'].iloc[0] for s in SLOTS)
        assert result['proj_total'].iloc[0] == pytest.approx(slot_sum, rel=1e-9)

    def test_proj_total_multiple_teams(self, estimator):
        df = make_multi_team_df(41.0, 40, [
            {'team_id': 1, 'team_name': 'Team A', **{s: 40 for s in SLOTS}},
            {'team_id': 2, 'team_name': 'Team B', **{s: 35 for s in SLOTS}},
        ])
        result = estimator.estimate(df)

        for _, row in result.iterrows():
            slot_sum = sum(row[f'proj_{s}'] for s in SLOTS)
            assert row['proj_total'] == pytest.approx(slot_sum, rel=1e-9)


class TestSlotGamesEstimatorEdgeCases:
    def test_zero_avg_pace_returns_zeros(self, estimator):
        df = make_df(avg_pace=0.0, days_remaining=82, slot_values={s: 10 for s in SLOTS})
        result = estimator.estimate(df)

        for slot in SLOTS:
            assert result[f'proj_{slot}'].iloc[0] == 0.0
        assert result['proj_total'].iloc[0] == 0.0

    def test_zero_slot_games_projects_zero(self, estimator):
        df = make_df(avg_pace=41.0, days_remaining=40, slot_values={s: 0 for s in SLOTS})
        result = estimator.estimate(df)

        for slot in SLOTS:
            assert result[f'proj_{slot}'].iloc[0] == pytest.approx(0.0, abs=1e-9)

    def test_empty_dataframe_returns_empty(self, estimator):
        result = estimator.estimate(pd.DataFrame())

        assert result.empty
        assert 'proj_total' in result.columns

    def test_output_columns_present(self, estimator):
        df = make_df(avg_pace=41.0, days_remaining=40)
        result = estimator.estimate(df)

        assert 'team_id' in result.columns
        assert 'team_name' in result.columns
        for slot in SLOTS:
            assert f'proj_{slot}' in result.columns
        assert 'proj_total' in result.columns

    def test_zero_days_remaining_method2_equals_gp(self, estimator):
        avg_pace = 41.0
        gp = 40
        df = make_df(avg_pace=avg_pace, days_remaining=0, slot_values={s: gp for s in SLOTS})
        result = estimator.estimate(df)

        w1 = 1 - avg_pace / 82
        w2 = avg_pace / 82
        m1 = min(gp * (82 / avg_pace), 82)
        m2 = gp
        expected = w1 * m1 + w2 * m2

        assert result['proj_PG'].iloc[0] == pytest.approx(expected, rel=1e-6)
