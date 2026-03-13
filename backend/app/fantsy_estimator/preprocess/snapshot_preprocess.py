"""Preprocess team_daily_snapshot: add gp_in_period and avg_*_in_period per (team, period_id)."""

from __future__ import annotations

import pandas as pd

from ..columns import TeamDailySnapshotColumns
from .preprocess_columns import PreprocessColumns


class SnapshotPreprocess:
    """
    Adds per-period averages and gp_in_period to a team_daily_snapshot DataFrame.
    Uses actual previous period_id per team (no assumption that period_ids are consecutive).
    """

    def __init__(self) -> None:
        self.snapshot_columns = TeamDailySnapshotColumns
        self.columns = PreprocessColumns

    def transform(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Add columns: gp_in_period, avg_fgm_in_period, ..., avg_pts_in_period.
        First period per team has no previous row → new columns are NaN.
        """
        c = self.snapshot_columns
        out = df.copy()
        out = out.sort_values([c.TEAM_ID, c.SCORING_PERIOD_ID]).reset_index(drop=True)

        for col_name in self.columns.all_new():
            out[col_name] = float("nan")

        for team_id in out[c.TEAM_ID].unique():
            mask = out[c.TEAM_ID] == team_id
            idx = out.index[mask].tolist()
            if len(idx) == 0:
                continue
            prev_idx = [None] + idx[:-1]
            for cur_i, prev_i in zip(idx, prev_idx):
                if prev_i is None:
                    continue
                row_cur = out.loc[cur_i]
                row_prev = out.loc[prev_i]
                delta_gp = row_cur[c.GP] - row_prev[c.GP]
                out.loc[cur_i, PreprocessColumns.GP_IN_PERIOD] = delta_gp
                if delta_gp <= 0:
                    continue
                for stat in PreprocessColumns.SUM_STAT_COLUMNS:
                    if stat not in out.columns:
                        continue
                    delta_sum = row_cur[stat] - row_prev[stat]
                    avg_col_name = PreprocessColumns.STAT_TO_AVG_COLUMN[stat]
                    out.loc[cur_i, avg_col_name] = delta_sum / delta_gp

        return out
