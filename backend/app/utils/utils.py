from datetime import date, datetime, timedelta, timezone
import pandas as pd

def is_team_exists(team_id: int, totals_df: pd.DataFrame) -> bool:
    return team_id in totals_df['team_id'].unique()
    

def latest_client_date() -> date:
    """Today's date in the furthest-ahead timezone (UTC+14).

    Date pickers send the viewer's local "today"; comparing that to the
    server's UTC date rejects a perfectly valid end date for anyone east of
    UTC in the hours after their midnight. Data past the real latest game day
    can't exist anyway, so the window just clamps to it."""
    return (datetime.now(timezone.utc) + timedelta(hours=14)).date()
