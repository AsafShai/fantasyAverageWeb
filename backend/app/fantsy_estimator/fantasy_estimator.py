"""Fantasy estimator module."""

from __future__ import annotations

import logging

import pandas as pd

import numpy as np

from .configuration import FantasyConfiguration
from .columns import TeamDailySnapshotColumns
from .output_tables.column_names import OutputColumnNames
from .preprocess import PerTeamPreprocess, PreprocessColumns, SnapshotPreprocess
from .estimation import WindowEstimator

# Map avg_*_in_period -> snapshot column name for current_state from last row
_AVG_TO_SNAPSHOT = {v: k for k, v in PreprocessColumns.STAT_TO_AVG_COLUMN.items()}


class FantasyEstimator:
    """Placeholder for fantasy estimation logic."""

    def __init__(self) -> None:
        """Initialize the estimator. Awaiting instructions."""
        self.logger = logging.getLogger(f"{__name__}.{self.__class__.__name__}")
        self.fantasy_configuration = FantasyConfiguration()
        self.columns = TeamDailySnapshotColumns
        self.preprocess = SnapshotPreprocess()
        self.per_team_preprocess = PerTeamPreprocess()
        self.window_estimator = WindowEstimator(
            window_size=self.fantasy_configuration.window_size,
            decay=self.fantasy_configuration.window_decay,
        )

    def _validate_team_daily_snapshot_columns(self, df: pd.DataFrame) -> None:
        """
        Check that df has all columns required for team_daily_snapshot.
        Raises ValueError with the list of missing columns if any are missing.
        """
        required = set(self.columns.all())
        actual = set(df.columns)
        missing = required - actual
        if missing:
            raise ValueError(
                f"DataFrame is missing required team_daily_snapshot columns: {sorted(missing)}"
            )

    def _preprocess_team(self, df_team: pd.DataFrame) -> pd.DataFrame:
        """
        Per-team preprocess: remove NaN rows and period_id 0, assign period_index.
        Call this inside the team loop after slicing by team_id.
        """
        return self.per_team_preprocess.transform(df_team)

    def _compute_final_and_variance(
        self,
        mean_vector: pd.DataFrame,
        covariance_matrix: pd.DataFrame,
        last_row: pd.Series,
        nba_avg_pace: float,
        mean_gp_per_period: float,
    ) -> dict:
        """
        From window mean/cov and current state, compute estimated_final and variance per stat
        (plan: max_gp, projected_total_gp, remaining_games, then scale; fg_pct/ft_pct via ratio + delta method).
        """
        cfg = self.fantasy_configuration
        c = self.columns
        max_gp = cfg.num_nba_games * cfg.num_players_in_team
        num_games_played_now = float(last_row[c.GP])
        denom = nba_avg_pace * 10
        if denom <= 0:
            projected_total_gp = max_gp
        else:
            pace_ratio = num_games_played_now / denom
            season_progress = nba_avg_pace / cfg.num_nba_games if cfg.num_nba_games else 1.0
            x = cfg.catch_up_boost_max * (1.0 - season_progress)
            projected_total_gp = min(max_gp, pace_ratio * (1.0 + x) * max_gp)
        remaining_games = max(0.0, projected_total_gp - num_games_played_now)

        stat_cols = list(WindowEstimator.stat_columns())
        current_state = {}
        for av in stat_cols:
            snap = _AVG_TO_SNAPSHOT.get(av)
            current_state[av] = float(last_row[snap]) if snap in last_row.index else 0.0

        estimated_final_component = {}
        for av in stat_cols:
            estimated_final_component[av] = current_state[av] + mean_vector.loc[av, "mean"] * remaining_games

        # Σ̂ = cov of per-game averages. Var(total of n games) = n * G̃ * Σ̂
        # where G̃ = mean_gp_per_period (avg player-games per period).
        full_cov_remaining = covariance_matrix * remaining_games * mean_gp_per_period
        variance_component = {av: full_cov_remaining.loc[av, av] for av in stat_cols}

        # Percentage stats: ratio + delta method with correlation
        def ratio_mean(mu_x: float, mu_y: float) -> float:
            if mu_y == 0:
                return np.nan
            return mu_x / mu_y

        def ratio_var(mu_x: float, mu_y: float, var_x: float, var_y: float, cov_xy: float) -> float:
            if mu_y == 0:
                return np.nan
            return (1 / mu_y) ** 2 * var_x + (mu_x / mu_y**2) ** 2 * var_y - 2 * (mu_x / mu_y**3) * cov_xy

        est_fgm = estimated_final_component[PreprocessColumns.AVG_FGM_IN_PERIOD]
        est_fga = estimated_final_component[PreprocessColumns.AVG_FGA_IN_PERIOD]
        est_ftm = estimated_final_component[PreprocessColumns.AVG_FTM_IN_PERIOD]
        est_fta = estimated_final_component[PreprocessColumns.AVG_FTA_IN_PERIOD]
        var_fgm = variance_component[PreprocessColumns.AVG_FGM_IN_PERIOD]
        var_fga = variance_component[PreprocessColumns.AVG_FGA_IN_PERIOD]
        var_ftm = variance_component[PreprocessColumns.AVG_FTM_IN_PERIOD]
        var_fta = variance_component[PreprocessColumns.AVG_FTA_IN_PERIOD]
        cov_fgm_fga = full_cov_remaining.loc[PreprocessColumns.AVG_FGM_IN_PERIOD, PreprocessColumns.AVG_FGA_IN_PERIOD]
        cov_ftm_fta = full_cov_remaining.loc[PreprocessColumns.AVG_FTM_IN_PERIOD, PreprocessColumns.AVG_FTA_IN_PERIOD]

        estimated_final_fg_pct = ratio_mean(est_fgm, est_fga)
        variance_fg_pct = ratio_var(est_fgm, est_fga, var_fgm, var_fga, cov_fgm_fga)
        estimated_final_ft_pct = ratio_mean(est_ftm, est_fta)
        variance_ft_pct = ratio_var(est_ftm, est_fta, var_ftm, var_fta, cov_ftm_fta)

        # Store FG%/FT% as percentage (0-100) so results show 47.2 not 0.472; variance in (pct)^2
        out = {
            OutputColumnNames.EstimatedFinal.FG_PCT: estimated_final_fg_pct * 100.0 if not np.isnan(estimated_final_fg_pct) else np.nan,
            OutputColumnNames.Variance.FG_PCT: variance_fg_pct * 10000.0 if not np.isnan(variance_fg_pct) else np.nan,
            OutputColumnNames.EstimatedFinal.FT_PCT: estimated_final_ft_pct * 100.0 if not np.isnan(estimated_final_ft_pct) else np.nan,
            OutputColumnNames.Variance.FT_PCT: variance_ft_pct * 10000.0 if not np.isnan(variance_ft_pct) else np.nan,
            "projected_total_gp": projected_total_gp,
        }
        for stat in ("three_pm", "reb", "ast", "stl", "blk", "pts"):
            av = PreprocessColumns.STAT_TO_AVG_COLUMN[stat]
            out[OutputColumnNames.EstimatedFinal.for_stat(stat)] = estimated_final_component[av]
            out[OutputColumnNames.Variance.for_stat(stat)] = variance_component[av]
        # For Monte Carlo: 10-dim mean and 10x10 cov of season totals (same order as stat_cols)
        mean_10 = np.array([estimated_final_component[av] for av in stat_cols], dtype=float)
        cov_10 = full_cov_remaining.loc[stat_cols, stat_cols].values.astype(float)
        return out, mean_10, cov_10

    def _estimate_per_team(
        self,
        df_team: pd.DataFrame,
        nba_avg_pace: float,
    ) -> tuple[dict, np.ndarray, np.ndarray]:
        """
        Run estimation for a single team: window mean/cov, then compute estimated_final and variance
        per stat. Returns (row_dict, mean_10, cov_10) for the predictions table and Monte Carlo.
        """
        c = self.columns
        team_id = df_team[c.TEAM_ID].iloc[0]
        team_name = df_team[c.TEAM_NAME].iloc[0]
        mean_arr, cov_arr = self.window_estimator.fit(df_team)
        stat_cols = list(WindowEstimator.stat_columns())
        mean_vector = pd.DataFrame(
            mean_arr.reshape(-1, 1),
            index=stat_cols,
            columns=["mean"],
        )
        covariance_matrix = pd.DataFrame(
            cov_arr,
            index=stat_cols,
            columns=stat_cols,
        )
        # Use latest date within latest period so current state is true cumulative (not an earlier day in the period)
        last_row = (
            df_team.sort_values([PreprocessColumns.PERIOD_INDEX, c.DATE]).iloc[-1]
        )
        mean_gp_per_period = float(df_team[PreprocessColumns.GP_IN_PERIOD].mean())
        row, mean_10, cov_10 = self._compute_final_and_variance(
            mean_vector, covariance_matrix, last_row, nba_avg_pace, mean_gp_per_period
        )
        row[c.TEAM_ID] = team_id
        row[c.TEAM_NAME] = team_name
        row[OutputColumnNames.Metadata.NBA_AVG_PACE] = nba_avg_pace
        row["as_of_date"] = last_row[c.DATE]
        return row, mean_10, cov_10

    def _run_monte_carlo_ranking(
        self,
        mc_data: list[tuple[int, str, np.ndarray, np.ndarray, float]],
    ) -> tuple[pd.DataFrame, pd.DataFrame]:
        """
        Run Monte Carlo: sample each team's season totals from N(mean_10, cov_10);
        derive 8 stats; rank per stat (1st=N pts, ..., last=1); average points over runs.
        Also track per-run final rank by total points → P(team finishes in rank r).

        Returns
        -------
        ranking_df : team_id, team_name, expected_pts_* per stat, total_expected_pts (sorted by total).
        rank_prob_df : long table: team_id, team_name, rank, prob (one row per team per rank; dynamic n_teams).
        """
        if not mc_data:
            return pd.DataFrame(), pd.DataFrame()
        n_teams = len(mc_data)
        n_runs = self.fantasy_configuration.num_monte_carlo
        # Order of 8 stats for ranking: fg_pct, ft_pct, three_pm, reb, ast, stl, blk, pts
        stat_names_8 = list(OutputColumnNames.STAT_NAMES)
        # Accumulator: (n_teams, 8) for expected points per stat
        pts_accum = np.zeros((n_teams, 8))
        # Count how many runs each team finished in each rank (1..n_teams) by total points
        rank_count = np.zeros((n_teams, n_teams), dtype=np.int64)
        rng = np.random.default_rng()
        for _ in range(n_runs):
            # (n_teams, 10) sampled totals per team
            samples_10 = np.zeros((n_teams, 10))
            for i, (_, __, mean_10, cov_10, ___) in enumerate(mc_data):
                cov = np.array(cov_10, dtype=float)
                cov = cov + 1e-6 * np.eye(cov.shape[0])
                try:
                    samples_10[i] = rng.multivariate_normal(mean_10, cov)
                except np.linalg.LinAlgError:
                    samples_10[i] = mean_10
            fgm, fga = samples_10[:, 0], np.clip(samples_10[:, 1], 1e-10, None)
            ftm, fta = samples_10[:, 2], np.clip(samples_10[:, 3], 1e-10, None)
            stats_8 = np.column_stack([
                fgm / fga, ftm / fta,
                samples_10[:, 4], samples_10[:, 5], samples_10[:, 6],
                samples_10[:, 7], samples_10[:, 8], samples_10[:, 9],
            ])
            # Points per stat this run
            run_pts = np.zeros((n_teams, 8))
            for j in range(8):
                ranks = pd.Series(stats_8[:, j]).rank(ascending=False, method="average").values
                run_pts[:, j] = n_teams + 1 - ranks
            pts_accum += run_pts
            # Total points this run → final rank (1 = 1st place)
            total_pts = run_pts.sum(axis=1)
            finish_rank = pd.Series(total_pts).rank(ascending=False, method="first").astype(int).values
            for i in range(n_teams):
                r = int(finish_rank[i])  # 1..n_teams
                rank_count[i, r - 1] += 1
        pts_accum /= n_runs
        # Build DataFrame
        rows = []
        for i, (team_id, team_name, _, _, projected_total_gp) in enumerate(mc_data):
            row = {
                self.columns.TEAM_ID: team_id,
                self.columns.TEAM_NAME: team_name,
                "projected_total_gp": projected_total_gp,
            }
            for j, stat in enumerate(stat_names_8):
                row[OutputColumnNames.RankingExpectedPts.for_stat(stat)] = pts_accum[i, j]
            row[OutputColumnNames.RankingExpectedPts.TOTAL] = pts_accum[i, :].sum()
            rows.append(row)
        out_cols = (
            [self.columns.TEAM_ID, self.columns.TEAM_NAME, "projected_total_gp"]
            + list(OutputColumnNames.RankingExpectedPts.all())
            + [OutputColumnNames.RankingExpectedPts.TOTAL]
        )
        df_out = pd.DataFrame(rows, columns=out_cols)
        df_out = df_out.sort_values(
            OutputColumnNames.RankingExpectedPts.TOTAL, ascending=False
        ).reset_index(drop=True)
        df_out.insert(0, "rank", range(1, len(df_out) + 1))

        # Long format: one row per (team, rank) with prob
        rank_prob = rank_count / n_runs
        rank_prob_rows = []
        for i, (team_id, team_name, _, _, _) in enumerate(mc_data):
            for r in range(1, n_teams + 1):
                rank_prob_rows.append({
                    self.columns.TEAM_ID: team_id,
                    self.columns.TEAM_NAME: team_name,
                    "rank": r,
                    "prob": rank_prob[i, r - 1],
                })
        rank_prob_df = pd.DataFrame(
            rank_prob_rows,
            columns=[self.columns.TEAM_ID, self.columns.TEAM_NAME, "rank", "prob"],
        )
        return df_out, rank_prob_df

    def _log_input_stats(self, df: pd.DataFrame) -> None:
        """Log summary stats for the input team_daily_snapshot DataFrame."""
        c = self.columns
        n_rows = len(df)
        n_teams = df[c.TEAM_ID].nunique()
        n_periods = df[c.SCORING_PERIOD_ID].nunique()
        n_dates = df[c.DATE].nunique()
        date_min, date_max = df[c.DATE].min(), df[c.DATE].max()
        total_gp = int(df[c.GP].sum())
        self.logger.info(
            "Input snapshot: rows=%d, unique_teams=%d, unique_scoring_period_ids=%d",
            n_rows,
            n_teams,
            n_periods,
        )
        self.logger.info("Unique dates: %d, range: %s to %s", n_dates, date_min, date_max)
        self.logger.info("Total GP (games played) across snapshot: %d", total_gp)

    def estimate(
        self,
        df: pd.DataFrame,
        nba_avg_pace: float,
    ) -> tuple[pd.DataFrame, pd.DataFrame]:
        """
        Run estimation: for each eligible team, compute estimated_final and variance per stat,
        then run Monte Carlo to get expected ranking points per stat. Returns two DataFrames.

        Parameters
        ----------
        df : pandas DataFrame
            team_daily_snapshot data (columns per TeamDailySnapshotColumns).
        nba_avg_pace : float
            NBA games played so far (average pace) at time of run.

        Returns
        -------
        tuple of (predictions_df, ranking_df, rank_prob_df)
            predictions_df: one row per team with estimated_final_*, variance_*, as_of_date, projected_total_gp.
            ranking_df: one row per team with expected_pts_* per stat and total_expected_pts (Monte Carlo).
            rank_prob_df: long table — team_id, team_name, rank, prob (one row per team per rank; dynamic n_teams).
        """
        self._validate_team_daily_snapshot_columns(df)
        self._log_input_stats(df)
        preprocess_df = self.preprocess.transform(df)
        c = self.columns
        min_period_id = self.fantasy_configuration.minimum_period_id
        results: list[dict] = []
        mc_data: list[tuple[int, str, np.ndarray, np.ndarray, float]] = []
        for team_id in preprocess_df[c.TEAM_ID].unique():
            df_team = preprocess_df[preprocess_df[c.TEAM_ID] == team_id]
            df_team = self._preprocess_team(df_team)
            if df_team.empty:
                self.logger.debug("Skipping team_id=%s: no rows after per-team preprocess", team_id)
                continue
            if df_team[PreprocessColumns.PERIOD_INDEX].max() <= min_period_id:
                self.logger.debug(
                    "Skipping team_id=%s: max(period_index)=%s <= minimum_period_id=%s",
                    team_id,
                    df_team[PreprocessColumns.PERIOD_INDEX].max(),
                    min_period_id,
                )
                continue
            result, mean_10, cov_10 = self._estimate_per_team(df_team, nba_avg_pace)
            self.logger.debug("team_id=%s estimated_final_pts=%s", team_id, result.get(OutputColumnNames.EstimatedFinal.PTS))
            results.append(result)
            mc_data.append((result[c.TEAM_ID], result[c.TEAM_NAME], mean_10, cov_10, result["projected_total_gp"]))
        if not results:
            return pd.DataFrame(), pd.DataFrame(), pd.DataFrame()
        out_cols = (
            [c.TEAM_ID, c.TEAM_NAME, "as_of_date", "projected_total_gp"]
            + list(OutputColumnNames.EstimatedFinal.all())
            + list(OutputColumnNames.Variance.all())
            + [OutputColumnNames.Metadata.NBA_AVG_PACE]
        )
        predictions_df = pd.DataFrame(results, columns=out_cols)
        ranking_df, rank_prob_df = self._run_monte_carlo_ranking(mc_data)
        return predictions_df, ranking_df, rank_prob_df