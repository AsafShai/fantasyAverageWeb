import math

import pandas as pd

from app.utils.roster_slots import SLOT_CAPS, SLOT_NAMES as SLOTS


def _first_number(df: pd.DataFrame, column: str) -> float:
    """First value of `column` as a float, NaN when the column is missing or empty (None)."""
    if column not in df.columns:
        return math.nan
    value = pd.to_numeric(df[column], errors='coerce').iloc[0]
    return float(value)


class SlotGamesEstimator:
    """
    Projects season-end games per roster slot for each fantasy team.

    Blends two methods weighted by how far through the NBA season we are:
      - Method 1 (pace extrapolation): dominates early in season
      - Method 2 (days-remaining projection): dominates late in season — games used
        so far plus the slot's fill rate per game day times the game days left
    """

    def estimate(self, slot_pace_df: pd.DataFrame) -> pd.DataFrame:
        """
        Args:
            slot_pace_df: output of get_team_slot_pace_df() — one row per fantasy team
                          with columns: team_id, team_name, PG..UTIL,
                          nba_avg_pace, nba_game_days_elapsed, nba_game_days_remaining

        Returns:
            DataFrame with team_id, team_name, proj_PG..proj_UTIL, proj_total
        """
        empty_cols = ['team_id', 'team_name'] + [f'proj_{s}' for s in SLOTS] + ['proj_total']
        if slot_pace_df.empty:
            return pd.DataFrame({c: pd.Series(dtype='float64') for c in empty_cols})

        avg_pace = float(slot_pace_df['nba_avg_pace'].iloc[0])
        days_elapsed = _first_number(slot_pace_df, 'nba_game_days_elapsed')
        days_remaining = _first_number(slot_pace_df, 'nba_game_days_remaining')
        # Method 2 needs both day counts (the calendar fetch can fail, and on opening
        # night nothing has elapsed yet); without them method 1 carries the estimate.
        has_days = days_elapsed > 0 and days_remaining >= 0

        if avg_pace == 0:
            result = pd.DataFrame(slot_pace_df[['team_id', 'team_name']])
            for slot in SLOTS:
                result[f'proj_{slot}'] = 0.0
            result['proj_total'] = 0.0
            return result

        w2 = avg_pace / 82
        w1 = 1 - w2

        result = pd.DataFrame(slot_pace_df[['team_id', 'team_name']])

        for slot in SLOTS:
            cap = SLOT_CAPS[slot]
            g = slot_pace_df[slot]

            m1 = (g * (82 / avg_pace)).clip(upper=cap)
            if not has_days:
                result[f'proj_{slot}'] = m1
                continue
            # The rate is per game day, not per NBA team game, so it can be multiplied
            # by the game days left: there are about two game days per team game.
            m2 = (g + (g / days_elapsed) * days_remaining).clip(upper=cap)

            result[f'proj_{slot}'] = w1 * m1 + w2 * m2

        proj_cols = [f'proj_{s}' for s in SLOTS]
        result['proj_total'] = result[proj_cols].sum(axis=1)

        return result
