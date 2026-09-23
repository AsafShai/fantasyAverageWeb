import asyncio
import logging
import time
from datetime import datetime

from fastapi import APIRouter, HTTPException, Query
from typing import Optional

from app.models.matchup_models import DefRanks, DefValues, PlayerMatchupResponse
from app.models.projection_models import Projection, ProjectionStats
from app.services.data_provider import DataProvider
from app.services.db_service import DBService
from app.services.depth_chart_service import DepthChartService
from app.services.live_projection_service import LiveProjectionService
from app.services.nba_matchup_service import NbaMatchupService
from app.utils.name_matching import normalize_player_name

router = APIRouter()
logger = logging.getLogger(__name__)

_matchup_service = NbaMatchupService()
_data_provider = DataProvider()
_projection_service = LiveProjectionService()
_depth_chart_service = DepthChartService()


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


@router.get('/current-slate-date', response_model=Optional[str])
async def get_current_slate_date() -> Optional[str]:
    """ISO date the default "Upcoming (live)" view currently resolves to, or
    None in the offseason. Independent of /today's player list — that list
    can be empty even when a real slate date is known (or vice versa isn't
    possible, but the two must never be inferred from each other), so the UI
    needs this to label the picker correctly in every state."""
    await _matchup_service.get_games_today()
    return _matchup_service.get_schedule_date()

# Per-slate response cache: the full pipeline (schedule + fantasy roster +
# batch model predict) is ~1-2s; repeat opens of the same slate are served
# instantly. Keyed only by dates the slate picker actually offers (see
# _is_known_slate_date), so the key space stays small by construction —
# no eviction/size-cap machinery needed. Cleared on the nightly refresh
# (ModelNightlyService._invalidate_inference_store) so it never serves
# pre-fold-in projections.
_RESPONSE_CACHE_TTL_S = 300
_response_cache: dict[str, tuple[float, list[PlayerMatchupResponse]]] = {}


def clear_matchup_response_cache() -> None:
    _response_cache.clear()


async def _is_known_slate_date(date: str) -> bool:
    """Whether the slate picker offers this YYYYMMDD date: upcoming game days
    plus dates already in the feature store. Anything else is rejected before
    it costs a schedule fetch + model batch.

    Stored dates are checked first because that side is a single local-ish
    query, so a what-if date never pays for the upcoming-slate ESPN fetch as
    well. Same membership either way — the two sets are only ever unioned.
    """
    recent = await DBService().get_recent_game_dates()
    if date in {d.strftime('%Y%m%d') for d in recent}:
        return True
    upcoming = await _matchup_service.get_upcoming_game_dates()
    return date in {d.replace('-', '') for d in upcoming}


@router.get('/today', response_model=list[PlayerMatchupResponse])
async def get_matchups_today(
    date: Optional[str] = Query(
        default=None, pattern=r'^\d{8}$',
        description='YYYYMMDD — must be a date the slate picker offers (upcoming or stored)',
    )
) -> list[PlayerMatchupResponse]:
    # Cache first: only a date that already passed validation can be a key
    # here, so a hit never needs to revalidate — which otherwise costs a DB
    # round trip on the most common request of all.
    cache_key = date or 'today'
    hit = _response_cache.get(cache_key)
    if hit is not None and time.monotonic() - hit[0] < _RESPONSE_CACHE_TTL_S:
        return hit[1]

    if date is not None and not await _is_known_slate_date(date):
        raise HTTPException(status_code=404, detail=f'Unknown slate date: {date}')
    # Independent of one another: two ESPN reads and two DB reads, so they
    # overlap rather than queue. return_exceptions keeps each failure's
    # original handling — a slate/defense failure yields an empty response,
    # anything else still propagates.
    games_today, all_def, players_df, injury_rows = await asyncio.gather(
        _matchup_service.get_games_today(date=date),
        _matchup_service.get_all_def_data(),
        _data_provider.get_players_df(stat_split_type_id=0),
        DBService().load_all_injury_statuses(),
        return_exceptions=True,
    )
    if isinstance(games_today, BaseException) or isinstance(all_def, BaseException):
        failed = games_today if isinstance(games_today, BaseException) else all_def
        logger.error(f'Matchup data fetch failed, serving empty slate (date={date}): {type(failed).__name__}: {failed}', exc_info=failed)
        return []
    for result in (players_df, injury_rows):
        if isinstance(result, BaseException):
            raise result

    # The date the slate actually resolved to — explicit for a pinned date,
    # otherwise whatever get_games_today's default view landed on (None in
    # the offseason), so the UI can show which real day "Upcoming (live)" is.
    resolved_date = (
        datetime.strptime(date, '%Y%m%d').date().isoformat()
        if date is not None
        else _matchup_service.get_schedule_date()
    )

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

    injury_lookup = {normalize_player_name(row['player']): row['status'] for row in injury_rows}

    # Both need the slate, neither needs the other.
    depth_chart_names, projections = await asyncio.gather(
        _depth_chart_service.get_on_depth_chart_names(set(games_today.keys())),
        _projection_service.project_today(players_df, games_today),
        return_exceptions=True,
    )
    if isinstance(depth_chart_names, BaseException):
        raise depth_chart_names
    if isinstance(projections, BaseException):
        logger.error(f'Live projection fetch failed, serving matchups without projections: {type(projections).__name__}: {projections}', exc_info=projections)
        projections = {}

    results: list[PlayerMatchupResponse] = []
    for row in players_df.to_dict('records'):
        pro_team: str = str(row.get('Pro Team', ''))
        game = games_today.get(pro_team)
        if game is None:
            continue
        opponent = game.opponent

        # def_ranks/def_values are season-to-date opponent defense — genuinely
        # empty before this season's first game is ingested. That's not a
        # reason to hide the player/projection too: fall back to neutral
        # values (rank 15 = league-average, matching the existing per-category
        # fallback below) rather than dropping the row entirely.
        team_pace = pace_map.get(opponent, league_avg_pace)
        opp_ranks = def_ranks.get(opponent, {})
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
            game_date=resolved_date,
            on_depth_chart=normalize_player_name(row['Name']) in depth_chart_names.get(pro_team, set()),
            injury_status=injury_lookup.get(normalize_player_name(row['Name'])),
        ))

    logger.info(
        f'Matchups built for slate {resolved_date}: {len(games_today)} teams playing, '
        f'{len(results)} players, {sum(1 for r in results if r.projection is not None)} with projections'
    )
    if results:
        _response_cache[cache_key] = (time.monotonic(), results)
    return results
