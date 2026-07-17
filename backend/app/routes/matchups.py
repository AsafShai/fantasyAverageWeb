import asyncio
import logging
import time

from fastapi import APIRouter, Query
from typing import Optional

from app.models.matchup_models import DefRanks, DefValues, PlayerMatchupResponse
from app.models.projection_models import Projection, ProjectionStats
from app.services.data_provider import DataProvider
from app.services.db_service import DBService
from app.services.live_projection_service import LiveProjectionService
from app.services.nba_matchup_service import NbaMatchupService

router = APIRouter()
logger = logging.getLogger(__name__)

_matchup_service = NbaMatchupService()
_data_provider = DataProvider()
_projection_service = LiveProjectionService()


@router.get('/dates', response_model=list[str])
async def get_known_game_dates() -> list[str]:
    """Game dates present in the feature store (newest first) — the options
    the what-if slate picker offers, so users never guess a date. The UI only
    shows these behind the past-slates feature flag (off in production)."""
    dates = await DBService().get_recent_game_dates()
    return [d.isoformat() for d in dates]


@router.get('/upcoming-dates', response_model=list[str])
async def get_upcoming_game_dates() -> list[str]:
    """The next 5 game days on the schedule (ISO dates) — the default slate
    options shown to every user."""
    return await _matchup_service.get_upcoming_game_dates()

# Per-slate response cache: the full pipeline (schedule + fantasy roster +
# batch model predict) is ~5s; repeat opens of the same slate are served
# instantly. Vectors only change on the nightly refresh, so a short TTL is safe.
_RESPONSE_CACHE_TTL_S = 300
_response_cache: dict[str, tuple[float, list[PlayerMatchupResponse]]] = {}


@router.get('/today', response_model=list[PlayerMatchupResponse])
async def get_matchups_today(
    date: Optional[str] = Query(default=None, description='YYYYMMDD — fetch schedule for this date instead of today (for testing)')
) -> list[PlayerMatchupResponse]:
    cache_key = date or 'today'
    hit = _response_cache.get(cache_key)
    if hit is not None and time.monotonic() - hit[0] < _RESPONSE_CACHE_TTL_S:
        return hit[1]
    try:
        games_today = await _matchup_service.get_games_today(date=date)
        all_def = await _matchup_service.get_all_def_data()
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

    try:
        projections = await _projection_service.project_today(players_df, games_today)
    except Exception as e:
        logger.error(f'Live projection fetch failed: {e}')
        projections = {}

    results: list[PlayerMatchupResponse] = []
    for _, row in players_df.iterrows():
        pro_team: str = str(row.get('Pro Team', ''))
        game = games_today.get(pro_team)
        if game is None or game.opponent not in def_ranks:
            continue
        opponent = game.opponent

        team_pace = pace_map.get(opponent, league_avg_pace)
        opp_ranks = def_ranks[opponent]
        opp_vals = def_values.get(opponent, {})
        positions_raw: str = str(row.get('Positions', 'Unknown'))
        positions = [p.strip() for p in positions_raw.split(',') if p.strip() and p.strip() != 'Unknown']

        proj = projections.get(row['Name'])
        projection = None
        if proj is not None:
            projection = Projection(
                default_minutes=proj['default_minutes'],
                status=proj['status'],
                reason=proj['reason'],
                stats=ProjectionStats(**proj['stats']) if proj['stats'] else None,
            )

        results.append(PlayerMatchupResponse(
            player_name=row['Name'],
            pro_team=pro_team,
            opponent=opponent,
            is_home=game.is_home,
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
            projection=projection,
        ))

    if results:
        _response_cache[cache_key] = (time.monotonic(), results)
    return results
