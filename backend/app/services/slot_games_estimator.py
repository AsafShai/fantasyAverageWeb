import pandas as pd

SLOT_CAPS = {
    'PG': 82, 'SG': 82, 'SF': 82, 'PF': 82,
    'C': 82, 'G': 82, 'F': 82, 'UTIL': 248,
}
SLOTS = list(SLOT_CAPS.keys())


class SlotGamesEstimator:
    """
    Projects season-end games per roster slot for each fantasy team.

    Blends two methods weighted by how far through the NBA season we are:
      - Method 1 (pace extrapolation): dominates early in season
      - Method 2 (days-remaining projection): dominates late in season
    """

    def estimate(self, slot_pace_df: pd.DataFrame) -> pd.DataFrame:
        """
        Args:
            slot_pace_df: output of get_team_slot_pace_df() — one row per fantasy team
                          with columns: team_id, team_name, PG..UTIL,
                          nba_avg_pace, nba_game_days_remaining

        Returns:
            DataFrame with team_id, team_name, proj_PG..proj_UTIL, proj_total
        """
        empty_cols = ['team_id', 'team_name'] + [f'proj_{s}' for s in SLOTS] + ['proj_total']
        if slot_pace_df.empty:
            return pd.DataFrame({c: pd.Series(dtype='float64') for c in empty_cols})

        avg_pace = float(slot_pace_df['nba_avg_pace'].iloc[0])
        days_remaining = float(slot_pace_df['nba_game_days_remaining'].iloc[0])

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
            m2 = (g + (g / avg_pace) * days_remaining).clip(upper=cap)

            result[f'proj_{slot}'] = w1 * m1 + w2 * m2

        proj_cols = [f'proj_{s}' for s in SLOTS]
        result['proj_total'] = result[proj_cols].sum(axis=1)

        return result
