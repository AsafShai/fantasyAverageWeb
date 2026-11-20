"""Tonight against this morning's official standings (plan section 7 step 4,
decision 7): Rankings and Today movers, Top 5 deltas, the heatmap's GP "+N",
the league averages that moved, date ranges that end today and the live point
on Rankings Over Time.

"This morning's official standings" is ESPN's official frame, the same
baseline the team page's ``tonight`` block uses (PR 4): tonight = live frames
minus official frames. Averages views compare the settled flavour (finished
games only), totals views the in-progress one (plan decision 1).

Everything here is computed in memory and never stored."""
import logging
from datetime import date, timedelta
from typing import Iterable, Optional, Sequence

import pandas as pd

from app.config import settings
from app.models import RankChanges, RankMover
from app.services import rank_moves
from app.utils.category_storage import (
    RANKINGS_FIXED_CATEGORIES, SNAPSHOT_FIXED_CATEGORIES, TOTAL_KEY, extra_categories,
)
from app.utils.constants import DERIVED_CATEGORIES, RATIO_CATEGORIES

logger = logging.getLogger(__name__)

_RANKINGS_COLUMNS = {
    'FG%': 'rk_fg_pct', 'FT%': 'rk_ft_pct', '3PM': 'rk_three_pm', 'REB': 'rk_reb',
    'AST': 'rk_ast', 'STL': 'rk_stl', 'BLK': 'rk_blk', 'PTS': 'rk_pts',
}
_STAT_COLUMNS = {
    'FG%': 'fg_pct', 'FT%': 'ft_pct', '3PM': 'three_pm', 'REB': 'reb',
    'AST': 'ast', 'STL': 'stl', 'BLK': 'blk', 'PTS': 'pts',
}
_ID_COLUMNS = ('team_id', 'team_name')


# --- which day tonight is ----------------------------------------------------

def slate_date(period: int) -> date:
    """The date a period's snapshot is stored under (DBService.upsert_daily_snapshot)."""
    return settings.season_start + timedelta(days=period - 1)


def period_of(night: date) -> int:
    """The scoring period of a night: the inverse of ``slate_date``."""
    return (night - settings.season_start).days + 1


def is_finished_night(state, night: date) -> bool:
    """True when the live overlay is ``night``'s and every one of its games is
    final: official standings through the night before plus all of ``night``,
    i.e. what ESPN's own standings will show once it rolls the period over.
    Between the nightly job and that rollover this is the only source with
    the night in it. False with the flag off (``state`` None), before the
    games are over, or once ESPN has moved on to the next period."""
    return (
        state is not None
        and state.active
        and state.period is not None
        and slate_date(state.period) == night
        and state.games_total > 0
        and state.games_final >= state.games_total
    )


def range_reaches_tonight(state, end_date: date) -> bool:
    """A date range ends today when it runs to ESPN's current period's day or
    later (a viewer east of the US is already a day ahead). Never with the
    flag off (``state`` None)."""
    return state is not None and state.period is not None and end_date >= slate_date(state.period)


# --- movers ------------------------------------------------------------------

def _points(frame: pd.DataFrame, categories: Sequence[str]):
    """{team_id: {category: points, TOTAL: total}}, names and GP of a rankings frame."""
    cats = [c for c in categories if c in frame.columns]
    points, names, gp = {}, {}, {}
    for _, row in frame.iterrows():
        tid = int(row['team_id'])
        entry = {c: (None if pd.isna(row[c]) else float(row[c])) for c in cats}
        entry[TOTAL_KEY] = float(row['TOTAL_POINTS'])
        points[tid] = entry
        names[tid] = str(row['team_name'])
        if 'GP' in frame.columns and not pd.isna(row['GP']):
            gp[tid] = int(round(float(row['GP'])))
    return points, names, gp


def _raw_stats(frame: Optional[pd.DataFrame], categories: Sequence[str]):
    """{team_id: {category: raw total}} of a totals frame; None without one."""
    if frame is None:
        return None
    cats = [c for c in categories if c in frame.columns]
    return {
        int(row['team_id']): {c: float(row[c]) for c in cats if not pd.isna(row[c])}
        for _, row in frame.iterrows()
    }


def rank_changes_between(official: pd.DataFrame, live: pd.DataFrame, categories: Sequence[str],
                         period: int, official_totals: Optional[pd.DataFrame] = None,
                         live_totals: Optional[pd.DataFrame] = None) -> RankChanges:
    """Each team's move tonight: ``official`` and ``live`` are rankings frames
    (roto points per category, TOTAL_POINTS, GP). With the raw totals frames
    (totals mode) it also says how much of each counting stat a team added."""
    before, _, gp_before = _points(official, categories)
    after, names, gp_after = _points(live, categories)
    return RankChanges(previous_period=period - 1, latest_period=period,
                       teams=rank_moves.changes_between(
                           before, after, names, gp_before, gp_after,
                           _raw_stats(official_totals, categories), _raw_stats(live_totals, categories)))


def movers_between(official: pd.DataFrame, live: pd.DataFrame, categories: Sequence[str]) -> list[RankMover]:
    before, _, _ = _points(official, categories)
    after, names, _ = _points(live, categories)
    return rank_moves.movers_between(before, after, names)


def gp_tonight(official: pd.DataFrame, live: pd.DataFrame, team_ids: Iterable[int]) -> list[int]:
    """Games counted tonight per team, in ``team_ids`` order (the heatmap's GP "+N")."""
    def gp(frame):
        return {int(r['team_id']): float(r['GP']) for _, r in frame.iterrows()}
    was, now = gp(official), gp(live)
    return [max(0, int(round(now.get(t, 0) - was.get(t, now.get(t, 0))))) for t in team_ids]


# --- date ranges -------------------------------------------------------------

def as_snapshot(frame: pd.DataFrame) -> pd.DataFrame:
    """A live totals frame in the shape a stored snapshot row has (team id,
    name and one column per category code), to stand in as a range's end."""
    keep = [c for c in frame.columns if c in _ID_COLUMNS or pd.api.types.is_numeric_dtype(frame[c])]
    return frame[keep].copy()


# --- Rankings Over Time ------------------------------------------------------

def rankings_points(frame: pd.DataFrame, categories: Sequence[str], period: int) -> list[dict]:
    """Tonight's point for a rankings source, shaped like a stored rankings row
    after DBService._rankings_row_to_point."""
    cats = [c for c in categories if c in frame.columns]
    extras = any(c not in RANKINGS_FIXED_CATEGORIES for c in cats)
    day = slate_date(period)
    points = []
    for _, row in frame.iterrows():
        point = {'date': day, 'team_id': int(row['team_id']), 'team_name': str(row['team_name']),
                 'rk_total': float(row['TOTAL_POINTS']),
                 'gp': None if 'GP' not in frame.columns else int(round(float(row['GP']))),
                 'ranks': {c: float(row[c]) for c in cats} if extras else None}
        for cat, col in _RANKINGS_COLUMNS.items():
            if cat in cats:
                point[col] = float(row[cat])
        points.append(point)
    return points


def stat_points(totals: pd.DataFrame, period: int, per_game: bool) -> list[dict]:
    """Tonight's point for a stat source (season totals or per game), shaped
    like DBService._snapshot_row_to_point. Ratios are rebuilt from their
    made/attempted sources, as the stored rows hold them (a fraction)."""
    day = slate_date(period)
    points = []
    for _, row in totals.iterrows():
        values: dict[str, float] = {}
        for cat in row.index:
            if cat in _ID_COLUMNS or cat == 'GP' or not pd.api.types.is_number(row[cat]) or pd.isna(row[cat]):
                continue
            values[cat] = float(row[cat])
        for cat, (num, den) in RATIO_CATEGORIES.items():
            if cat in values and num in values and den in values:
                values[cat] = round(values[num] / values[den], 4) if values[den] else 0.0
        gp = int(round(float(row['GP']))) if 'GP' in row.index else None
        if per_game:
            values = {c: (v if c in DERIVED_CATEGORIES else round(v / gp, 4))
                      for c, v in values.items() if c in DERIVED_CATEGORIES or gp}
        point = {'date': day, 'team_id': int(row['team_id']), 'team_name': str(row['team_name']),
                 'gp': gp, 'values': values}
        for cat, col in _STAT_COLUMNS.items():
            point[col] = values.get(cat)
        points.append(point)
    return points


# --- reading the frames ------------------------------------------------------

async def _totals_frames(provider):
    """(official raw, official rankings, live raw, live rankings) for totals mode."""
    from app.services.ranking_service import RankingService
    categories = await provider.get_ranking_categories()
    reverse = await provider.get_reverse_categories()
    builder = RankingService()
    official_raw, official = builder._build_totals_rankings_df(await provider.get_totals_df(), categories, reverse)
    live_raw, live = builder._build_totals_rankings_df(await provider.get_totals_df(live=True), categories, reverse)
    return official_raw, official, live_raw, live


async def rankings_frames(provider, mode: str) -> tuple[pd.DataFrame, pd.DataFrame]:
    """(official, live) rankings frames for ``mode``: averages rank the
    settled flavour (finished games only), totals the in-progress one. Built
    exactly as the Rankings page builds its two tables."""
    if mode != 'totals':
        return await provider.get_rankings_df(), await provider.get_rankings_df(live=True)
    _, official, _, live = await _totals_frames(provider)
    return official, live


async def tonight_rank_changes(provider, mode: str, period: int) -> Optional[RankChanges]:
    """None when it cannot be built: the caller then serves last night's moves."""
    try:
        categories = await provider.get_ranking_categories()
        if mode == 'totals':
            official_raw, official, live_raw, live = await _totals_frames(provider)
            return rank_changes_between(official, live, categories, period, official_raw, live_raw)
        official, live = await rankings_frames(provider, mode)
        return rank_changes_between(official, live, categories, period)
    except Exception as e:
        logger.warning(f"Tonight rank changes unavailable: {type(e).__name__}: {e}", exc_info=True)
        return None


async def tonight_movers(provider) -> Optional[list[RankMover]]:
    try:
        official, live = await rankings_frames(provider, 'averages')
        return movers_between(official, live, await provider.get_ranking_categories())
    except Exception as e:
        logger.warning(f"Tonight movers unavailable: {type(e).__name__}: {e}", exc_info=True)
        return None


async def race_points(provider, source: str, period: int,
                      team_ids: Optional[Sequence[int]] = None) -> Optional[list[dict]]:
    """Tonight's point per team for a Rankings Over Time source (plan section
    4, "a dashed live point for tonight"). Averages-based sources count
    finished games only, totals-based ones every started game. None on
    failure: the chart then shows the stored days only."""
    try:
        if source in ('rankings_avg', 'rankings_totals'):
            _, live = await rankings_frames(provider, 'averages' if source == 'rankings_avg' else 'totals')
            points = rankings_points(live, await provider.get_ranking_categories(), period)
        elif source == 'snapshot':
            points = stat_points(await provider.get_totals_df(live=True), period, per_game=False)
        else:
            points = stat_points(await provider.get_totals_df(live=True, settled=True), period, per_game=True)
    except Exception as e:
        logger.warning(f"Live race point unavailable: {type(e).__name__}: {e}", exc_info=True)
        return None
    if team_ids:
        wanted = set(team_ids)
        points = [p for p in points if p['team_id'] in wanted]
    return points
