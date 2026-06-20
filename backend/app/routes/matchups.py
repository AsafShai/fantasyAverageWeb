import asyncio
import logging

from fastapi import APIRouter

from app.models.matchup_models import DefRanks, PlayerMatchupResponse
from app.services.data_provider import DataProvider
from app.services.nba_matchup_service import NbaMatchupService

router = APIRouter()
logger = logging.getLogger(__name__)

_matchup_service = NbaMatchupService()
_data_provider = DataProvider()


@router.get('/today', response_model=list[PlayerMatchupResponse])
async def get_matchups_today() -> list[PlayerMatchupResponse]:
    try:
        games_today = await _matchup_service.get_games_today()
        # nba_api calls are synchronous — run in thread pool to avoid blocking event loop
        loop = asyncio.get_event_loop()
        def_ranks = await loop.run_in_executor(None, _matchup_service.get_defensive_ranks)
        pace_map = await loop.run_in_executor(None, _matchup_service.get_team_pace)
    except Exception as e:
        logger.error(f'Matchup data fetch failed: {e}')
        return []

    if not pace_map:
        league_avg_pace = 98.0
    else:
        league_avg_pace = sum(pace_map.values()) / len(pace_map)

    players_df = await _data_provider.get_players_df(stat_split_type_id=0)

    results: list[PlayerMatchupResponse] = []
    for _, row in players_df.iterrows():
        pro_team: str = row.get('pro_team', '')
        if pro_team not in games_today:
            continue
        opponent = games_today[pro_team]
        if opponent not in def_ranks:
            continue

        team_pace = pace_map.get(pro_team, league_avg_pace)
        pace_badge = _matchup_service.get_pace_badge(team_pace, league_avg_pace)

        opp_ranks = def_ranks[opponent]
        results.append(PlayerMatchupResponse(
            player_name=row['player_name'],
            pro_team=pro_team,
            opponent=opponent,
            pace_badge=pace_badge,
            def_ranks=DefRanks(
                pts=opp_ranks.get('pts', 15),
                reb=opp_ranks.get('reb', 15),
                ast=opp_ranks.get('ast', 15),
                stl=opp_ranks.get('stl', 15),
                blk=opp_ranks.get('blk', 15),
                three_pm=opp_ranks.get('three_pm', 15),
                fg_pct=opp_ranks.get('fg_pct', 15),
            ),
        ))

    return results
