import numpy as np
import pandas as pd
import pytest

from app.fantsy_estimator import FantasyEstimator
from app.fantsy_estimator.estimation import WindowEstimator
from app.fantsy_estimator.output_tables.column_names import OutputColumnNames
from app.fantsy_estimator.preprocess.preprocess_columns import PreprocessColumns

from tests.services.test_fantasy_estimator_fallback import make_snapshot

GP = PreprocessColumns.GP_IN_PERIOD


def rows(gp: list[float]) -> pd.DataFrame:
    """Period rows with every stat present and the given games per period."""
    df = pd.DataFrame({col: np.ones(len(gp)) for col in WindowEstimator.stat_columns()})
    df[GP] = gp
    return df


class TestMeanWeights:
    def test_short_history_weights_rows_by_games(self):
        omega = WindowEstimator(window_size=10).mean_weights(rows([2, 6, 2]))
        assert omega == pytest.approx([0.2, 0.6, 0.2])

    def test_equal_rows_give_one_over_n(self):
        omega = WindowEstimator(window_size=10).mean_weights(rows([5] * 8))
        assert np.sum(omega ** 2) == pytest.approx(1 / 8)

    def test_long_history_sums_to_one_and_leans_on_recent_rows(self):
        omega = WindowEstimator(window_size=10, decay=0.9).mean_weights(rows([5] * 40))
        assert omega.sum() == pytest.approx(1.0)
        assert omega[-1] > omega[0]
        # Decayed windows use fewer rows than all 40 — the mean is less sure than 1/40.
        assert np.sum(omega ** 2) > 1 / 40

    def test_window_mean_matches_its_weights(self):
        """The weights are the ones fit() really uses: Σ ω y equals fit()'s mean."""
        rng = np.random.default_rng(0)
        df = rows(list(rng.integers(2, 9, 30).astype(float)))
        for col in WindowEstimator.stat_columns():
            df[col] = rng.normal(10, 2, len(df))
        est = WindowEstimator(window_size=10, decay=0.93)
        mean, _ = est.fit(df)
        omega = est.mean_weights(df)
        y = df[list(WindowEstimator.stat_columns())].to_numpy()
        assert omega @ y == pytest.approx(mean)


class TestMeanUncertaintyInVariance:
    @staticmethod
    def variance(scale: float, days: int, luck: float = 1.0) -> float:
        est = FantasyEstimator()
        est.fantasy_configuration.luck_scale = luck
        est.fantasy_configuration.mean_uncertainty_scale = scale
        est.fantasy_configuration.num_monte_carlo = 10
        df = pd.concat([make_snapshot(1, days), make_snapshot(2, days)], ignore_index=True)
        pred, _, _ = est.estimate(df, nba_avg_pace=days / 2, slot_proj_df=None)
        return float(pred[OutputColumnNames.Variance.for_stat('pts')].iloc[0])

    def test_early_season_variance_is_much_wider(self):
        """Two weeks in, most of the season is still to come and the per-game level
        is a guess: the variance grows several times over."""
        assert self.variance(1.0, 14) > 5 * self.variance(0.0, 14)

    def test_the_extra_shrinks_as_the_season_fills_in(self):
        early = self.variance(1.0, 14) / self.variance(0.0, 14)
        late = self.variance(1.0, 100) / self.variance(0.0, 100)
        assert late < early / 2

    def test_defaults_are_the_fit_on_last_season(self):
        config = FantasyEstimator().fantasy_configuration
        assert (config.luck_scale, config.mean_uncertainty_scale) == (6.0, 2.35)

    def test_luck_scale_multiplies_the_old_variance(self):
        assert self.variance(0.0, 30, luck=6.0) == pytest.approx(6 * self.variance(0.0, 30), rel=1e-6)

    def test_scale_multiplies_only_the_extra(self):
        """variance = base · (1 + scale · x): the extra at scale 3 is three times scale 1's."""
        base = self.variance(0.0, 14)
        assert self.variance(3.0, 14) - base == pytest.approx(3 * (self.variance(1.0, 14) - base), rel=1e-6)

