"""NBA player profile bio + windowed stats."""

from __future__ import annotations

import logging
from datetime import date
from typing import Optional

from app.config import settings
from app.models.nba_player_models import NbaPlayerBio, NbaPlayerStatsResponse
from app.models.player import PlayerStats, StatTimePeriod
from app.services.data_provider import DataProvider
from app.services.db_service import DBService
from app.services.nba_player_catalog import get_player_bio, parse_espn_athlete_id
from app.services.player_service import espn_season_string, get_season_anchor_date
from app.utils.name_matching import resolve_join_key

logger = logging.getLogger(__name__)

_ZERO_STATS = PlayerStats(
    pts=0.0,
    reb=0.0,
    ast=0.0,
    stl=0.0,
    blk=0.0,
    fgm=0.0,
    fga=0.0,
    ftm=0.0,
    fta=0.0,
    fg_percentage=0.0,
    ft_percentage=0.0,
    three_pm=0.0,
    minutes=0.0,
    gp=0,
)


def _totals_from_db_row(row: dict) -> PlayerStats:
    return PlayerStats(
        pts=float(row.get("pts") or 0),
        reb=float(row.get("reb") or 0),
        ast=float(row.get("ast") or 0),
        stl=float(row.get("stl") or 0),
        blk=float(row.get("blk") or 0),
        fgm=float(row.get("fgm") or 0),
        fga=float(row.get("fga") or 0),
        ftm=float(row.get("ftm") or 0),
        fta=float(row.get("fta") or 0),
        fg_percentage=float(row.get("fg_pct") or 0),
        ft_percentage=float(row.get("ft_pct") or 0),
        three_pm=float(row.get("three_pm") or 0),
        minutes=float(row.get("min") or 0),
        gp=int(row.get("gp") or 0),
    )


def _totals_from_espn_row(row) -> PlayerStats:
    fga = float(row.get("FGA") or 0)
    fta = float(row.get("FTA") or 0)
    fgm = float(row.get("FGM") or 0)
    ftm = float(row.get("FTM") or 0)
    fg_pct = float(row["FG%"]) if "FG%" in row and row["FG%"] == row["FG%"] else (
        (fgm / fga) if fga else 0.0
    )
    ft_pct = float(row["FT%"]) if "FT%" in row and row["FT%"] == row["FT%"] else (
        (ftm / fta) if fta else 0.0
    )
    return PlayerStats(
        pts=float(row.get("PTS") or 0),
        reb=float(row.get("REB") or 0),
        ast=float(row.get("AST") or 0),
        stl=float(row.get("STL") or 0),
        blk=float(row.get("BLK") or 0),
        fgm=fgm,
        fga=fga,
        ftm=ftm,
        fta=fta,
        fg_percentage=fg_pct,
        ft_percentage=ft_pct,
        three_pm=float(row.get("3PM") or 0),
        minutes=float(row.get("MIN") or 0),
        gp=int(row.get("GP") or 0),
    )


def _averages_from_totals(totals: PlayerStats) -> PlayerStats:
    gp = totals.gp
    if gp <= 0:
        return _ZERO_STATS.model_copy()
    return PlayerStats(
        pts=round(totals.pts / gp, 1),
        reb=round(totals.reb / gp, 1),
        ast=round(totals.ast / gp, 1),
        stl=round(totals.stl / gp, 1),
        blk=round(totals.blk / gp, 1),
        fgm=round(totals.fgm / gp, 1),
        fga=round(totals.fga / gp, 1),
        ftm=round(totals.ftm / gp, 1),
        fta=round(totals.fta / gp, 1),
        fg_percentage=totals.fg_percentage,
        ft_percentage=totals.ft_percentage,
        three_pm=round(totals.three_pm / gp, 1),
        minutes=round(totals.minutes / gp, 1),
        gp=gp,
    )


def _empty_response(player_id: int) -> NbaPlayerStatsResponse:
    return NbaPlayerStatsResponse(
        player_id=player_id,
        totals=_ZERO_STATS.model_copy(),
        averages=_ZERO_STATS.model_copy(),
        has_data=False,
        actual_start=None,
        actual_end=None,
    )


class NbaPlayerService:
    def __init__(self):
        self.data_provider = DataProvider()
        self.db_service = DBService()

    def get_bio(self, player_id: str | int) -> Optional[NbaPlayerBio]:
        return get_player_bio(player_id)

    async def get_stats(
        self,
        player_id: str | int,
        time_period: StatTimePeriod,
        start: Optional[date] = None,
        end: Optional[date] = None,
    ) -> NbaPlayerStatsResponse:
        espn_id = parse_espn_athlete_id(player_id)
        bio = get_player_bio(espn_id)
        if bio is None:
            raise KeyError(f"Player {player_id} not found")

        season = espn_season_string(settings.season_id)
        anchor = await get_season_anchor_date(season, self.db_service)
        resolved_start, resolved_end = StatTimePeriod.resolve_window(
            time_period, start, end, settings.season_start, today=anchor
        )

        db_row, actual_start, actual_end = await self.db_service.aggregate_single_player_games(
            espn_id, resolved_start, resolved_end, season
        )
        if db_row is not None:
            totals = _totals_from_db_row(db_row)
            return NbaPlayerStatsResponse(
                player_id=espn_id,
                totals=totals,
                averages=_averages_from_totals(totals),
                has_data=True,
                actual_start=actual_start,
                actual_end=actual_end,
            )

        if time_period == StatTimePeriod.CUSTOM:
            return _empty_response(espn_id)

        # Preset fallback: ESPN fantasy player pool split stats by name.
        split_id = StatTimePeriod.to_stat_split_id(time_period)
        try:
            espn_df = await self.data_provider.get_players_df(stat_split_type_id=split_id)
        except Exception as e:
            logger.error("ESPN players fallback failed for %s: %s", espn_id, e)
            return _empty_response(espn_id)

        if espn_df is None or espn_df.empty or "Name" not in espn_df.columns:
            return _empty_response(espn_id)

        key = resolve_join_key(bio.display_name)
        espn_df = espn_df.copy()
        espn_df["_join_key"] = espn_df["Name"].map(resolve_join_key)
        matches = espn_df[espn_df["_join_key"] == key]
        if matches.empty:
            return _empty_response(espn_id)

        totals = _totals_from_espn_row(matches.iloc[0])
        return NbaPlayerStatsResponse(
            player_id=espn_id,
            totals=totals,
            averages=_averages_from_totals(totals),
            has_data=True,
            actual_start=resolved_start,
            actual_end=resolved_end,
        )
