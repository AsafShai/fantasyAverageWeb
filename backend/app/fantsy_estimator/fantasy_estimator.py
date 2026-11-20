"""Fantasy estimator module."""

from __future__ import annotations

import logging

import numpy as np
import polars as pl

from app.utils import pdcompat
from app.utils.frames import dicts_frame

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

    def _validate_team_daily_snapshot_columns(self, df: pl.DataFrame) -> None:
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

    def _preprocess_team(self, df_team: pl.DataFrame) -> pl.DataFrame:
        """
        Per-team preprocess: remove NaN rows and period_id 0, assign period_index.
        Call this inside the team loop after slicing by team_id.
        """
        return self.per_team_preprocess.transform(df_team)

    @property
    def periods_needed(self) -> int:
        """Game days (scoring periods with games) every team needs before the
        league is estimated: more than minimum_period_id."""
        return self.fantasy_configuration.minimum_period_id + 1

    def _teams(self, preprocess_df: pl.DataFrame) -> dict:
        """team_id -> that team's rows after the per-team preprocess (the
        period_index column numbers its game days)."""
        c = self.columns
        return {
            team_id: self._preprocess_team(preprocess_df.filter(pl.col(c.TEAM_ID) == team_id))
            for team_id in preprocess_df[c.TEAM_ID].unique(maintain_order=True).to_list()
        }

    @staticmethod
    def _fewest_periods(teams: dict) -> int:
        return min((len(df_team) for df_team in teams.values()), default=0)

    def periods_played(self, df: pl.DataFrame) -> int:
        """The fewest game days any team has, counted exactly as ``estimate``
        counts them before it runs (0 when a team hasn't played)."""
        return self._fewest_periods(self._teams(self.preprocess.transform(df)))

    def _compute_final_and_variance(
        self,
        mean_vector: dict,
        covariance_matrix: np.ndarray,
        last_row: dict,
        nba_avg_pace: float,
        mean_gp_per_period: float,
        projected_total_gp: float,
        mean_weight_sq: float = 0.0,
    ) -> dict:
        """
        From window mean/cov and current state, compute estimated_final and variance per stat
        (fg_pct/ft_pct via ratio + delta method).
        """
        c = self.columns
        num_games_played_now = float(last_row[c.GP])
        remaining_games = max(0.0, projected_total_gp - num_games_played_now)

        stat_cols = list(WindowEstimator.stat_columns())
        current_state = {}
        for av in stat_cols:
            snap = _AVG_TO_SNAPSHOT.get(av)
            current_state[av] = float(last_row[snap]) if snap in last_row else 0.0

        estimated_final_component = {}
        for av in stat_cols:
            estimated_final_component[av] = current_state[av] + mean_vector[av] * remaining_games

        # Σ̂ = cov of per-game averages. Var(total of n games) = n * G̃ * Σ̂
        # where G̃ = mean_gp_per_period (avg player-games per period) — the luck of
        # the games to come, were each team's per-game level known exactly.
        # It is not: the mean is itself an estimate, Var(μ̂) = Σ̂ · Σω² (mean_weight_sq),
        # and its error repeats in every remaining game, adding n² · Σ̂ · Σω².
        # Together: n · G̃ · Σ̂ · (1 + n · Σω² / G̃) — with equal weights over N games
        # seen, 1 + n / N. Both terms carry a scale fitted on last season (see
        # FantasyConfiguration).
        config = self.fantasy_configuration
        mean_error = (
            config.mean_uncertainty_scale * remaining_games * mean_weight_sq / mean_gp_per_period
            if mean_gp_per_period > 0 else 0.0
        )
        full_cov_remaining = covariance_matrix * remaining_games * mean_gp_per_period * (config.luck_scale + mean_error)
        pos = {av: i for i, av in enumerate(stat_cols)}
        variance_component = {av: full_cov_remaining[pos[av], pos[av]] for av in stat_cols}

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
        cov_fgm_fga = full_cov_remaining[pos[PreprocessColumns.AVG_FGM_IN_PERIOD], pos[PreprocessColumns.AVG_FGA_IN_PERIOD]]
        cov_ftm_fta = full_cov_remaining[pos[PreprocessColumns.AVG_FTM_IN_PERIOD], pos[PreprocessColumns.AVG_FTA_IN_PERIOD]]

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
        cov_10 = np.asarray(full_cov_remaining, dtype=float)
        return out, mean_10, cov_10

    @staticmethod
    def _fallback_total_gp(games_played_now: float, nba_avg_pace: float, season_cap: float) -> float:
        """
        Season-end games for a team with no slot projection (slot usage came back empty,
        or the team is missing from it): its own games so far stretched to a full 82-game
        season, capped at the league's games limit. A full season's cap scaled by pace
        would be the games an on-pace team has played by today, leaving no games to come.
        """
        if nba_avg_pace <= 0:
            return season_cap
        return min(games_played_now * (82 / nba_avg_pace), season_cap)

    def _estimate_per_team(
        self,
        df_team: pl.DataFrame,
        nba_avg_pace: float,
        slot_proj_df: pl.DataFrame | None = None,
    ) -> tuple[dict, np.ndarray, np.ndarray]:
        """
        Run estimation for a single team: window mean/cov, then compute estimated_final and variance
        per stat. Returns (row_dict, mean_10, cov_10) for the predictions table and Monte Carlo.
        """
        from app.services.slot_games_estimator import SLOT_CAPS
        c = self.columns
        team_id = df_team[c.TEAM_ID][0]
        team_name = df_team[c.TEAM_NAME][0]
        mean_arr, cov_arr = self.window_estimator.fit(df_team)
        stat_cols = list(WindowEstimator.stat_columns())
        mean_vector = dict(zip(stat_cols, mean_arr))
        covariance_matrix = np.asarray(cov_arr, dtype=float)
        order = pdcompat.lexsort([df_team[PreprocessColumns.PERIOD_INDEX].to_numpy(), df_team[c.DATE].to_list()])
        last_row = df_team.row(int(order[-1]), named=True)
        mean_gp_per_period = float(pdcompat.nanmean(df_team[PreprocessColumns.GP_IN_PERIOD]))

        team_row = (
            slot_proj_df.filter(pl.col('team_id') == team_id)
            if slot_proj_df is not None and not slot_proj_df.is_empty()
            else None
        )
        if team_row is not None and not team_row.is_empty():
            projected_total_gp = float(team_row['proj_total'][0])
        else:
            projected_total_gp = self._fallback_total_gp(
                float(last_row[c.GP]), nba_avg_pace, float(sum(SLOT_CAPS.values()))
            )

        omega = self.window_estimator.mean_weights(df_team)
        row, mean_10, cov_10 = self._compute_final_and_variance(
            mean_vector, covariance_matrix, last_row, nba_avg_pace, mean_gp_per_period,
            projected_total_gp, float(np.sum(omega ** 2)),
        )
        row[c.TEAM_ID] = team_id
        row[c.TEAM_NAME] = team_name
        row[OutputColumnNames.Metadata.NBA_AVG_PACE] = nba_avg_pace
        row["as_of_date"] = last_row[c.DATE]
        return row, mean_10, cov_10

    def _run_monte_carlo_ranking(
        self,
        mc_data: list[tuple[int, str, np.ndarray, np.ndarray, float]],
    ) -> tuple[pl.DataFrame, pl.DataFrame]:
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
            return pl.DataFrame(), pl.DataFrame()
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
                ranks = pdcompat.rank(stats_8[:, j], ascending=False, method="average")
                run_pts[:, j] = n_teams + 1 - ranks
            pts_accum += run_pts
            # Total points this run → final rank (1 = 1st place)
            total_pts = run_pts.sum(axis=1)
            finish_rank = pdcompat.rank(total_pts, ascending=False, method="first").astype(int)
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
        df_out = dicts_frame(rows, out_cols)
        df_out = df_out[pdcompat.argsort(
            df_out[OutputColumnNames.RankingExpectedPts.TOTAL].to_numpy(), ascending=False)]
        df_out = df_out.select(pl.Series("rank", range(1, df_out.height + 1), dtype=pl.Int64), pl.all())

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
        rank_prob_df = dicts_frame(
            rank_prob_rows,
            [self.columns.TEAM_ID, self.columns.TEAM_NAME, "rank", "prob"],
        )
        return df_out, rank_prob_df

    def _log_input_stats(self, df: pl.DataFrame) -> None:
        """Log summary stats for the input team_daily_snapshot DataFrame."""
        c = self.columns
        n_rows = len(df)
        n_teams = df[c.TEAM_ID].n_unique()
        n_periods = df[c.SCORING_PERIOD_ID].n_unique()
        n_dates = df[c.DATE].n_unique()
        date_min, date_max = df[c.DATE].min(), df[c.DATE].max()
        total_gp = int(df[c.GP].sum())
        self.logger.info(
            "Input snapshot: %d rows, %d teams, %d scoring period(s), dates %s..%s (%d), %d GP",
            n_rows, n_teams, n_periods, date_min, date_max, n_dates, total_gp,
        )

    def estimate(
        self,
        df: pl.DataFrame,
        nba_avg_pace: float,
        slot_proj_df: pl.DataFrame | None = None,
    ) -> tuple[pl.DataFrame, pl.DataFrame, pl.DataFrame]:
        """
        Run estimation: for each eligible team, compute estimated_final and variance per stat,
        then run Monte Carlo to get expected ranking points per stat. Returns two DataFrames.

        Parameters
        ----------
        df : Polars DataFrame
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
        teams = self._teams(preprocess_df)
        # All teams or none: a ranking of only the teams with enough game days
        # would compare a partial league.
        fewest = self._fewest_periods(teams)
        if fewest < self.periods_needed:
            self.logger.info(
                "Not estimating yet: the fewest game days of any team is %s, every team needs %s",
                fewest, self.periods_needed,
            )
            return pl.DataFrame(), pl.DataFrame(), pl.DataFrame()
        results: list[dict] = []
        mc_data: list[tuple[int, str, np.ndarray, np.ndarray, float]] = []
        for team_id, df_team in teams.items():
            result, mean_10, cov_10 = self._estimate_per_team(df_team, nba_avg_pace, slot_proj_df)
            self.logger.debug("team_id=%s estimated_final_pts=%s", team_id, result.get(OutputColumnNames.EstimatedFinal.PTS))
            results.append(result)
            mc_data.append((result[c.TEAM_ID], result[c.TEAM_NAME], mean_10, cov_10, result["projected_total_gp"]))
        out_cols = (
            [c.TEAM_ID, c.TEAM_NAME, "as_of_date", "projected_total_gp"]
            + list(OutputColumnNames.EstimatedFinal.all())
            + list(OutputColumnNames.Variance.all())
            + [OutputColumnNames.Metadata.NBA_AVG_PACE]
        )
        predictions_df = dicts_frame(results, out_cols)
        ranking_df, rank_prob_df = self._run_monte_carlo_ranking(mc_data)
        return predictions_df, ranking_df, rank_prob_df