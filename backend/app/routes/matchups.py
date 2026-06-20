import asyncio
import logging

from fastapi import APIRouter, Query
from typing import Optional

from app.models.matchup_models import DefRanks, DefValues, PlayerMatchupResponse
from app.services.data_provider import DataProvider
from app.services.nba_matchup_service import NbaMatchupService

router = APIRouter()
logger = logging.getLogger(__name__)

_matchup_service = NbaMatchupService()
_data_provider = DataProvider()

@router.get('/today', response_model=list[PlayerMatchupResponse])
async def get_matchups_today(
    date: Optional[str] = Query(default=None, description='YYYYMMDD — fetch schedule for this date instead of today (for testing)')
) -> list[PlayerMatchupResponse]:
    try:
        games_today = await _matchup_service.get_games_today(date=date)
        # nba_api calls are synchronous — run in thread pool to avoid blocking event loop
        loop = asyncio.get_event_loop()
        all_def = await loop.run_in_executor(None, _matchup_service.get_all_def_data)
    except Exception as e:
        logger.error(f'Matchup data fetch failed: {e}')
        return []

    def_ranks = all_def['ranks']
    def_values = all_def['values']
    league_avg_raw = all_def['league_avg_values']
    pace_map = all_def['pace']

    if not pace_map:
        league_avg_pace = 98.0
    else:
        league_avg_pace = sum(pace_map.values()) / len(pace_map)

    league_avg_def = DefValues(
        pts=league_avg_raw.get('pts', 0.0),
        reb=league_avg_raw.get('reb', 0.0),
        ast=league_avg_raw.get('ast', 0.0),
        stl=league_avg_raw.get('stl', 0.0),
        blk=league_avg_raw.get('blk', 0.0),
        three_pm=league_avg_raw.get('three_pm', 0.0),
        fg_pct=league_avg_raw.get('fg_pct', 0.0),
    )

    players_df = await _data_provider.get_players_df(stat_split_type_id=0)

    results: list[PlayerMatchupResponse] = []
    for _, row in players_df.iterrows():
        pro_team: str = row.get('Pro Team', '')
        if pro_team not in games_today:
            continue
        opponent = games_today[pro_team]
        if opponent not in def_ranks:
            continue

        team_pace = pace_map.get(pro_team, league_avg_pace)
        opp_ranks = def_ranks[opponent]
        opp_vals = def_values.get(opponent, {})
        positions_raw: str = str(row.get('Positions', 'Unknown'))
        positions = [p.strip() for p in positions_raw.split(',') if p.strip() and p.strip() != 'Unknown']

        results.append(PlayerMatchupResponse(
            player_name=row['Name'],
            pro_team=pro_team,
            opponent=opponent,
            pace=round(team_pace, 1),
            league_avg_pace=round(league_avg_pace, 1),
            positions=positions,
            def_ranks=DefRanks(
                pts=opp_ranks.get('pts', 15),
                reb=opp_ranks.get('reb', 15),
                ast=opp_ranks.get('ast', 15),
                stl=opp_ranks.get('stl', 15),
                blk=opp_ranks.get('blk', 15),
                three_pm=opp_ranks.get('three_pm', 15),
                fg_pct=opp_ranks.get('fg_pct', 15),
            ),
            def_values=DefValues(
                pts=opp_vals.get('pts', 0.0),
                reb=opp_vals.get('reb', 0.0),
                ast=opp_vals.get('ast', 0.0),
                stl=opp_vals.get('stl', 0.0),
                blk=opp_vals.get('blk', 0.0),
                three_pm=opp_vals.get('three_pm', 0.0),
                fg_pct=opp_vals.get('fg_pct', 0.0),
            ),
            league_avg_def_values=league_avg_def,
        ))

    return results
