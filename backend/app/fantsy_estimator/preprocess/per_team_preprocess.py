"""
Per-team preprocess: remove invalid rows and assign team-local period_index (1, 2, 3, ...).

Applied to one team's preprocessed rows before the window estimator.
"""

from __future__ import annotations

import numpy as np
import polars as pl

from app.utils import pdcompat

from ..columns import TeamDailySnapshotColumns
from .preprocess_columns import PreprocessColumns


class PerTeamPreprocess:
    """
    Clean one team's preprocessed rows and assign real period IDs per team.

    1. Remove rows where scoring_period_id == 0 (team didn't play in that period).
    2. Remove NaN rows (team didn't start playing yet; gp_in_period or avg_* are NaN).
    3. Sort by scoring_period_id and assign period_index = 1, 2, 3, ... so each team
       has a local period index instead of the global scoring_period_id.
    """

    def __init__(self) -> None:
        self.snapshot_columns = TeamDailySnapshotColumns
        self.columns = PreprocessColumns

    def transform(self, df_team: pl.DataFrame) -> pl.DataFrame:
        """
        Return df_team with invalid rows removed and period_index added.

        Invalid rows: scoring_period_id == 0, or any of (gp_in_period, avg_*_in_period) is NaN.
        """
        c_snap = self.snapshot_columns
        c_pre = self.columns
        out = df_team

        # 1. Remove period id 0 (didn't play)
        if c_snap.SCORING_PERIOD_ID in out.columns:
            out = out.filter(pl.col(c_snap.SCORING_PERIOD_ID) != 0)

        # 2. Remove NaN rows (no play yet in that period)
        check_cols = [c_pre.GP_IN_PERIOD] + list(c_pre.STAT_TO_AVG_COLUMN.values())
        check_cols = [col for col in check_cols if col in out.columns]
        if check_cols:
            keep = np.ones(out.height, dtype=bool)
            for col in check_cols:
                keep &= ~np.isnan(pdcompat.as_float(out[col]))
            out = out.filter(pl.Series(keep))

        # 3. Sort by scoring_period_id and assign period_index = 1, 2, 3, ...
        if c_snap.SCORING_PERIOD_ID in out.columns:
            out = out[pdcompat.argsort(out[c_snap.SCORING_PERIOD_ID].to_numpy())]
        return out.with_columns(pl.Series(c_pre.PERIOD_INDEX, range(1, out.height + 1), dtype=pl.Int64))
