"""Moving window estimator: computes mean vector and covariance matrix for sum stats."""

from __future__ import annotations

import numpy as np
import pandas as pd

from ..preprocess.preprocess_columns import PreprocessColumns

# Stat columns (avg_*_in_period) in fixed order for the mean/cov vector dimensions.
_STAT_AVG_COLUMNS: tuple[str, ...] = tuple(
    PreprocessColumns.STAT_TO_AVG_COLUMN[s] for s in PreprocessColumns.SUM_STAT_COLUMNS
)


class WindowEstimator:
    """
    Computes estimated mean vector and covariance matrix for sum stats
    using a rolling window with recency-weighted combination.

    Algorithm:
    1. Drop NaN rows (first period per team has no delta).
    2. Weight each row by gp_in_period so periods with fewer games affect less.
    3. Slide a window of size `window_size` over the rows, stepping by `step_size`.
       For each window, compute weighted mean μ_t and weighted covariance Σ_t (by gp_in_period).
    4. Combine: final μ = Σ(w_t μ_t) / Σw_t, Σ = Σ(w_t Σ_t) / Σw_t,
       where w_t = decay^(N_windows - 1 - i) so the latest window has weight 1.
    """

    def __init__(
        self,
        window_size: int,
        decay: float = 0.9,
        step_size: int = 1,
    ) -> None:
        self.window_size = window_size
        self.decay = decay
        self.step_size = step_size

    def fit(self, df_team: pd.DataFrame) -> tuple[np.ndarray, np.ndarray]:
        """
        Estimate mean vector and covariance matrix for one team.

        Parameters
        ----------
        df_team : pd.DataFrame
            Preprocessed rows for one team (includes avg_*_in_period columns),
            ordered by scoring_period_id. May include NaN rows (first period).

        Returns
        -------
        mean_vector : np.ndarray, shape (d,)
            Recency-weighted mean of per-period averages across windows.
        covariance_matrix : np.ndarray, shape (d, d)
            Recency-weighted covariance matrix across windows.
        """
        stat_cols = list(_STAT_AVG_COLUMNS)
        valid = df_team[stat_cols].dropna()
        Y = valid.to_numpy(dtype=float)
        n_rows, d = Y.shape
        # Row weights: periods with more games played affect more
        gp_col = PreprocessColumns.GP_IN_PERIOD
        if gp_col in df_team.columns:
            W = df_team.loc[valid.index, gp_col].to_numpy(dtype=float)
            W = np.maximum(W, 0.0)
        else:
            W = np.ones(n_rows, dtype=float)

        L = self.window_size
        step = self.step_size

        def weighted_mean_cov(y: np.ndarray, w: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
            sw = w.sum()
            if sw <= 0:
                return y.mean(axis=0), np.zeros((d, d))
            mu = np.average(y, axis=0, weights=w)
            cov = np.cov(y.T, aweights=w, ddof=1) if y.shape[0] > 1 else np.zeros((d, d))
            return mu, cov

        if n_rows < 2:
            mean_vec = Y.mean(axis=0) if n_rows == 1 else np.zeros(d)
            cov_mat = np.zeros((d, d))
            return mean_vec, cov_mat

        if n_rows < L:
            mean_vec, cov_mat = weighted_mean_cov(Y, W)
            return mean_vec, cov_mat

        # Build time series of windows (each window weighted by gp_in_period)
        starts = list(range(0, n_rows - L + 1, step))
        if not starts:
            starts = [0]

        window_means: list[np.ndarray] = []
        window_covs: list[np.ndarray] = []

        for start in starts:
            window_y = Y[start : start + L]
            window_w = W[start : start + L]
            mu_t, cov_t = weighted_mean_cov(window_y, window_w)
            window_means.append(mu_t)
            window_covs.append(cov_t)

        # Recency weights: latest window gets weight 1, older windows decay
        n_windows = len(window_means)
        weights = np.array([self.decay ** (n_windows - 1 - i) for i in range(n_windows)])
        total_weight = weights.sum()

        mean_vec = sum(w * mu for w, mu in zip(weights, window_means)) / total_weight
        cov_mat = sum(w * cov for w, cov in zip(weights, window_covs)) / total_weight

        return np.asarray(mean_vec), np.asarray(cov_mat)

    @staticmethod
    def stat_columns() -> tuple[str, ...]:
        """Return the avg_*_in_period column names that define the vector dimensions."""
        return _STAT_AVG_COLUMNS
