"""Preprocess team_daily_snapshot: add gp_in_period and avg_*_in_period per (team, period_id)."""

from __future__ import annotations

import numpy as np
import polars as pl

from app.utils import pdcompat

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

    def transform(self, df: pl.DataFrame) -> pl.DataFrame:
        """
        Add columns: gp_in_period, avg_fgm_in_period, ..., avg_pts_in_period.
        First period per team has no previous row → new columns are NaN.
        Rows come back sorted by (team_id, scoring_period_id), stable.
        """
        c = self.snapshot_columns
        order = pdcompat.lexsort([df[c.TEAM_ID].to_numpy(), df[c.SCORING_PERIOD_ID].to_numpy()])
        out = df[order]
        n = out.height
        new = {col: np.full(n, np.nan) for col in self.columns.all_new()}
        teams = out[c.TEAM_ID].to_list()
        gp = out[c.GP].to_list()
        stats = {stat: out[stat].to_list() for stat in PreprocessColumns.SUM_STAT_COLUMNS if stat in out.columns}
        for i in range(1, n):
            if teams[i] != teams[i - 1]:
                continue
            delta_gp = gp[i] - gp[i - 1]
            new[PreprocessColumns.GP_IN_PERIOD][i] = delta_gp
            if delta_gp <= 0:
                continue
            for stat, values in stats.items():
                new[PreprocessColumns.STAT_TO_AVG_COLUMN[stat]][i] = (values[i] - values[i - 1]) / delta_gp
        return out.with_columns([pl.Series(col, arr, dtype=pl.Float64) for col, arr in new.items()])
