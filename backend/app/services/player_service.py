import logging
from datetime import date, datetime, timedelta
from typing import List, Optional, Tuple
import pandas as pd
from app.models import Player, PaginatedPlayers, StatTimePeriod
from app.exceptions import ResourceNotFoundError
from app.services.data_provider import DataProvider
from app.services.db_service import DBService
from app.builders.response_builder import ResponseBuilder
from app.utils.name_matching import normalize_player_name
from app.config import settings

logger = logging.getLogger(__name__)

# Known ESPN <-> NBA name mismatches that normalize_player_name alone can't
# resolve (e.g. suffix/nickname differences). Keyed by the ESPN-side
# normalized name, valued by the nba_api-side normalized name.
NAME_OVERRIDES: dict[str, str] = {}

_DB_STAT_COLS = {
    'PTS': 'pts', 'REB': 'reb', 'AST': 'ast', 'STL': 'stl', 'BLK': 'blk',
    'FGM': 'fgm', 'FGA': 'fga', 'FTM': 'ftm', 'FTA': 'fta', '3PM': 'three_pm',
    'MIN': 'min', 'FG%': 'fg_pct', 'FT%': 'ft_pct', 'GP': 'gp',
}

# "Known this season" must be independent of games played — a player out all
# year with a season-ending injury is still a real, identifiable player (zero
# row), not a name-join failure (no data). fs_player_games can't tell those
# apart (it only has rows for games actually played), so for preset periods
# identity instead comes from ESPN's own roster status (`Pro Team != 'FA'`),
# which is already present on every players/team request at no extra cost.
# Custom ranges skip this gate entirely (see build_windowed_players_df) since
# they have no ESPN split value to protect from being zeroed.

# Real calendar "today" is a dead anchor for last_7/15/30 once the season
# ends (today lands in the offseason, a stretch with zero games league-wide,
# so ~everyone reads as 0 GP). Anchor to the latest date with actual game
# data instead — equivalent to today during the season, still meaningful
# after it ends. Cached briefly since this only moves at most once/day
# (nightly ingest) but this runs on every players/team request.
_SEASON_ANCHOR_TTL = timedelta(hours=1)
_season_anchor_cache: dict = {'season': None, 'date': None, 'ts': None}


async def get_season_anchor_date(season: str, db_service: DBService) -> date:
    cached = _season_anchor_cache
    now = datetime.now()
    if (
        cached['season'] == season
        and cached['date'] is not None
        and now - cached['ts'] < _SEASON_ANCHOR_TTL
    ):
        return cached['date']
    latest = await db_service.get_latest_game_date(season)
    anchor = latest or date.today()
    _season_anchor_cache.update({'season': season, 'date': anchor, 'ts': now})
    return anchor


def espn_season_string(season_id: int) -> str:
    """ESPN season_id (int, e.g. 2026) -> NBA season string ("2025-26")."""
    return f"{season_id - 1}-{str(season_id)[-2:]}"


def _join_key(name: str) -> str:
    normalized = normalize_player_name(name)
    return NAME_OVERRIDES.get(normalized, normalized)


async def build_windowed_players_df(
    time_period: StatTimePeriod,
    espn_players_df: pd.DataFrame,
    db_service: DBService,
    start: Optional[date] = None,
    end: Optional[date] = None,
) -> Tuple[pd.DataFrame, Optional[date], Optional[date]]:
    """Overlay fs_player_games-aggregated stats onto an ESPN players DataFrame.

    For preset periods, a player is "known" if they're on a current NBA roster
    per ESPN (`Pro Team != 'FA'`), independent of whether they've played at
    all this season:
      - known, >=1 game in window -> DB-aggregated totals for the window.
      - known, 0 games in window  -> zeroed stats, gp=0, has_data=True (a real
        answer, whether they just didn't play in this window or have been out
        all season — not missing data).
      - unknown (ESPN free agent, no window rows) -> falls back to the ESPN
        split value already on the row.

    Custom ranges skip the roster gate entirely: there's no ESPN split to
    fall back to anyway, so every player is simply zeroed to their window
    totals (0 if they have no rows), always has_data=True.
    """
    season = espn_season_string(settings.season_id)
    anchor_date = await get_season_anchor_date(season, db_service)
    resolved_start, resolved_end = StatTimePeriod.resolve_window(
        time_period, start, end, settings.season_start, today=anchor_date
    )
    agg_df, actual_start, actual_end = await db_service.aggregate_player_games(
        resolved_start, resolved_end, season
    )

    merged = espn_players_df.copy()
    is_custom = time_period == StatTimePeriod.CUSTOM
    merged['_join_key'] = merged['Name'].map(_join_key)

    if agg_df.empty:
        windowed = pd.Series(False, index=merged.index)
    else:
        agg_df = agg_df.copy()
        agg_df['_join_key'] = agg_df['player_name'].map(_join_key)
        agg_df = agg_df.drop_duplicates('_join_key', keep='first')
        db_cols = ['_join_key'] + list(_DB_STAT_COLS.values())
        merged = merged.merge(agg_df[db_cols], on='_join_key', how='left', suffixes=('', '_db'))
        windowed = merged['gp'].notna()
        for espn_col, db_col in _DB_STAT_COLS.items():
            merged.loc[windowed, espn_col] = merged.loc[windowed, db_col]

    if is_custom:
        known = pd.Series(True, index=merged.index)
    else:
        known = (merged['Pro Team'] != 'FA') | windowed

    merged['has_data'] = True

    # If the DB had zero rows for ANYONE in this window (e.g. pre-season, or
    # any other edge case the anchor-date resolution doesn't cover), that's a
    # sign the window itself is empty — not that every matched player had a
    # blank stretch. Don't overwrite their existing ESPN split value with
    # zeros in that case; custom ranges have no ESPN fallback to preserve, so
    # they still zero out as before.
    skip_zeroing_empty_window = agg_df.empty and not is_custom

    zero_matched = known & ~windowed
    if zero_matched.any() and not skip_zeroing_empty_window:
        for espn_col in _DB_STAT_COLS:
            merged.loc[zero_matched, espn_col] = 0 if espn_col == 'GP' else 0.0

    unmatched = ~known
    if unmatched.any():
        missed = merged.loc[unmatched, 'Name'].tolist()
        logger.warning(
            f"{len(missed)} players did not resolve to a current-season NBA player "
            f"(time_period={time_period.value}): {missed[:20]}"
        )

    merged['GP'] = merged['GP'].astype(int)
    drop_cols = ['_join_key'] + list(_DB_STAT_COLS.values())
    merged = merged.drop(columns=[c for c in drop_cols if c in merged.columns])
    return merged, actual_start, actual_end


class PlayerService:
    """Service for player-related operations"""

    def __init__(self):
        self.data_provider = DataProvider()
        self.response_builder = ResponseBuilder()
        self.logger = logging.getLogger(__name__)

    async def get_all_players(
        self,
        page: int = 1,
        limit: int = 500,
        time_period: StatTimePeriod = StatTimePeriod.SEASON,
        start: Optional[date] = None,
        end: Optional[date] = None,
    ) -> PaginatedPlayers:
        """Get all players with pagination

        Args:
            page: Page number (1-indexed)
            limit: Number of players per page
            time_period: Time period for stats (season, last_7, last_15, last_30, custom)
            start: Start date, required when time_period is custom
            end: End date, required when time_period is custom
        """
        stat_split_id = StatTimePeriod.to_stat_split_id(time_period)
        players_df = await self.data_provider.get_players_df(stat_split_id)

        if players_df is None or players_df.empty:
            raise ResourceNotFoundError("No players found")

        players_df, actual_start, actual_end = await build_windowed_players_df(
            time_period, players_df, self.data_provider.db_service, start, end
        )

        total_count = len(players_df)
        start_idx = (page - 1) * limit
        end_idx = start_idx + limit

        page_df = players_df.iloc[start_idx:end_idx]
        players = self.response_builder.build_all_players_response(page_df)

        return PaginatedPlayers(
            players=players,
            total_count=total_count,
            page=page,
            limit=limit,
            has_more=end_idx < total_count,
            actual_start=actual_start,
            actual_end=actual_end,
        )
