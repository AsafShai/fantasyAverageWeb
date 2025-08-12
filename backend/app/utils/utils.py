import pandas as pd

def is_team_exists(team_id: int, totals_df: pd.DataFrame) -> bool:
    return team_id in totals_df['team_id'].unique()
    