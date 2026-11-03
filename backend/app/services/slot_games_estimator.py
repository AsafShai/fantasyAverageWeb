import math

import pandas as pd

from app.utils.roster_slots import SLOT_CAPS, SLOT_MULTIPLICITY, SLOT_NAMES as SLOTS


def _first_number(df: pd.DataFrame, column: str) -> float:
    """First value of `column` as a float, NaN when the column is missing or empty (None)."""
    if column not in df.columns:
        return math.nan
    value = pd.to_numeric(df[column], errors='coerce').iloc[0]
    return float(value)


# Weight on the max at the end of the season. Early on the max carries almost all of
# it: a team behind the rate after a week can still close the gap, so the rate means
# little; late in the season there is less time to catch up, so the rate counts more.
MAX_WEIGHT_AT_SEASON_END = 0.5


def max_weight(avg_pace: float) -> float:
    """Weight on the max in the projection: 1 on opening night, falling evenly with
    the NBA pace to MAX_WEIGHT_AT_SEASON_END after 82 games."""
    progress = min(max(avg_pace / 82, 0.0), 1.0)
    return 1 - (1 - MAX_WEIGHT_AT_SEASON_END) * progress


class SlotGamesEstimator:
    """
    Projects season-end games per roster slot for each fantasy team.

    The rate estimate blends two methods weighted by how far through the NBA season we are:
      - Method 1 (pace extrapolation): dominates early in season
      - Method 2 (days-remaining projection): dominates late in season — games used
        so far plus the slot's fill rate per game day times the game days left

    The projection is then max_weight * max + (1 - max_weight) * rate estimate, where
    max is the most games the slot can still finish on (used + one per game day left
    per roster slot, capped). Without the game days left there is no max, and the rate
    estimate stands alone.
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
        a = max_weight(avg_pace)

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
            rate_estimate = w1 * m1 + w2 * m2
            max_games = (g + days_remaining * SLOT_MULTIPLICITY[slot]).clip(upper=cap)

            result[f'proj_{slot}'] = a * max_games + (1 - a) * rate_estimate

        proj_cols = [f'proj_{s}' for s in SLOTS]
        result['proj_total'] = result[proj_cols].sum(axis=1)

        return result
