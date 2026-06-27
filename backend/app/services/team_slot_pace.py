import asyncio
import logging
import pandas as pd

from app.config import settings
from app.services.data_provider import DataProvider
from app.services.nba_stats_service import NBAStatsService

logger = logging.getLogger(__name__)

_NBA_AVG_PACE_FALLBACK = 65.9

_SLOT_NAMES = ['PG', 'SG', 'SF', 'PF', 'C', 'G', 'F', 'UTIL']


async def get_team_slot_pace_df() -> pd.DataFrame:
    """
    Returns a DataFrame with one row per fantasy team:
      team_id, team_name,
      PG, SG, SF, PF, C, G, F, UTIL  (games used per roster slot this season),
      nba_game_days_remaining          (game days left in the regular season),
      nba_avg_pace                     (avg games played per NBA team so far)
    """
    data_provider = DataProvider()
    nba_service = NBAStatsService()

    slot_usage = await data_provider.get_slot_usage()
    totals_df = await data_provider.get_totals_df()

    nba_avg_pace, game_days_remaining = await asyncio.gather(
        nba_service.get_nba_average_pace(settings.season_id),
        nba_service.get_nba_game_days_remaining(),
    )
    await nba_service.close()

    team_name_map = dict(zip(totals_df['team_id'], totals_df['team_name']))
    resolved_pace = nba_avg_pace if nba_avg_pace is not None else _NBA_AVG_PACE_FALLBACK

    rows = [
        {
            'team_id': team_id,
            'team_name': team_name_map.get(team_id, f'Team {team_id}'),
            **{s: slots.get(s, 0) for s in _SLOT_NAMES},
            'nba_game_days_remaining': game_days_remaining,
            'nba_avg_pace': resolved_pace,
        }
        for team_id, slots in slot_usage.items()
    ]

    return pd.DataFrame(rows)
