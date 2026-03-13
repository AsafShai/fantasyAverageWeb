"""
Per-team preprocess: remove invalid rows and assign team-local period_index (1, 2, 3, ...).

Applied to one team's preprocessed rows before the window estimator.
"""

from __future__ import annotations

import pandas as pd

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

    def transform(self, df_team: pd.DataFrame) -> pd.DataFrame:
        """
        Return a copy of df_team with invalid rows removed and period_index added.

        Invalid rows: scoring_period_id == 0, or any of (gp_in_period, avg_*_in_period) is NaN.
        """
        c_snap = self.snapshot_columns
        c_pre = self.columns
        out = df_team.copy()

        # 1. Remove period id 0 (didn't play)
        if c_snap.SCORING_PERIOD_ID in out.columns:
            out = out.loc[out[c_snap.SCORING_PERIOD_ID] != 0]

        # 2. Remove NaN rows (no play yet in that period)
        check_cols = [c_pre.GP_IN_PERIOD] + list(c_pre.STAT_TO_AVG_COLUMN.values())
        check_cols = [col for col in check_cols if col in out.columns]
        if check_cols:
            out = out.dropna(subset=check_cols)

        # 3. Sort by scoring_period_id and assign period_index = 1, 2, 3, ...
        if c_snap.SCORING_PERIOD_ID in out.columns:
            out = out.sort_values(c_snap.SCORING_PERIOD_ID).reset_index(drop=True)
        out[c_pre.PERIOD_INDEX] = range(1, len(out) + 1)

        return out
