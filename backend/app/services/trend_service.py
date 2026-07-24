import logging
from datetime import datetime, timedelta
from typing import Optional

import pandas as pd

from app.config import settings
from app.models.trend_models import (
    MinutesMoverItem,
    MinutesResponse,
    RegressionPlayerGroup,
    RegressionResponse,
    RegressionStatItem,
    UsageResponse,
    UsageRoleItem,
)
from app.services.db_service import DBService
from app.services.player_service import espn_season_string, get_season_anchor_date
from app.utils.name_matching import resolve_join_key

logger = logging.getLogger(__name__)

DRIFT_THRESHOLD = 0.35  # makes/g-equivalent, provisional — see trends_page_plan.md
DEFAULT_RECENCY_WINDOW_DAYS = 15
VALID_RECENCY_WINDOWS_DAYS = (7, 15, 30)
_TREND_CACHE_TTL = timedelta(hours=6)

# current_min_att / baseline_min_att: sample-size gates below which a pct is
# too noisy to trust (plan's volume gates), independent of drift_score.
_STAT_SPECS = {
    '3P%': {'att': 'fg3a', 'pct': 'fg3_pct', 'current_min_att': 40, 'baseline_min_att': 150},
    'FT%': {'att': 'fta', 'pct': 'ft_pct', 'current_min_att': 40, 'baseline_min_att': 150},
    'FG%': {'att': 'fga', 'pct': 'fg_pct', 'current_min_att': 100, 'baseline_min_att': 300},
}


def compute_regression_groups(
    current_df: pd.DataFrame,
    baseline_df: pd.DataFrame,
    games_last_15d: dict[int, int],
    players_df: pd.DataFrame,
) -> list[RegressionPlayerGroup]:
    """Pure calc: current-season vs prior-2-season baseline shooting -> volume-gated,
    drift-filtered, player-grouped regression items. No DB/network access."""
    if current_df.empty or baseline_df.empty:
        return []

    espn_by_name = {
        resolve_join_key(str(row.get('Name', ''))): row
        for _, row in players_df.iterrows()
    }
    baseline_by_id = {int(r['player_id']): r for _, r in baseline_df.iterrows()}

    groups: list[RegressionPlayerGroup] = []
    for _, current_row in current_df.iterrows():
        player_id = int(current_row['player_id'])
        baseline_row = baseline_by_id.get(player_id)
        if baseline_row is None:
            continue  # no baseline (rookie / first season) -> not ranked

        gp = current_row['gp']
        stats: list[RegressionStatItem] = []
        for stat_name, spec in _STAT_SPECS.items():
            current_att = current_row[spec['att']]
            baseline_att = baseline_row[spec['att']]
            if current_att < spec['current_min_att'] or baseline_att < spec['baseline_min_att']:
                continue
            current_pct = current_row[spec['pct']] * 100
            baseline_pct = baseline_row[spec['pct']] * 100
            dev = current_pct - baseline_pct
            attempts_per_game = current_att / gp if gp else 0.0
            drift_score = attempts_per_game * abs(dev) / 100
            if drift_score < DRIFT_THRESHOLD:
                continue
            stats.append(RegressionStatItem(
                stat=stat_name,
                current_pct=current_pct,
                baseline_pct=baseline_pct,
                dev=dev,
                attempts_per_game=attempts_per_game,
                drift_score=drift_score,
            ))

        if not stats:
            continue

        player_name = str(current_row['player_name'])
        espn_row = espn_by_name.get(resolve_join_key(player_name))
        if espn_row is None:
            logger.warning(f"No ESPN roster match for '{player_name}' — skipped from Shooting Regression")
            continue

        stats.sort(key=lambda s: abs(s.dev), reverse=True)
        fantasy_team_name = espn_row.get('fantasy_team_name')
        position = str(espn_row.get('Positions', 'Unknown')).split(',')[0].strip() or 'Unknown'

        groups.append(RegressionPlayerGroup(
            player_name=player_name,
            pro_team=str(espn_row.get('Pro Team', 'Unknown')),
            position=position,
            fantasy_status=fantasy_team_name if isinstance(fantasy_team_name, str) and fantasy_team_name else 'FA',
            games_last_15d=games_last_15d.get(player_id, 0),
            stats=stats,
        ))

    groups.sort(key=lambda g: max(s.drift_score for s in g.stats), reverse=True)
    return groups


MIN_SEASON_GP = 10
MIN_WINDOW_GP = 2
LOW_SAMPLE_GP = 3  # window_gp below this -> "partial" badge, regardless of window_days


def compute_minutes_movers(
    season_df: pd.DataFrame,
    window_df: pd.DataFrame,
    games_last_15d: dict[int, int],
    players_df: pd.DataFrame,
) -> list[MinutesMoverItem]:
    """Pure calc: season MPG vs MPG within the recency window (window_df is
    already date-bounded by the caller) -> eligibility-gated, player-level
    minutes movers. No DB/network access."""
    if season_df.empty or window_df.empty:
        return []

    espn_by_name = {
        resolve_join_key(str(row.get('Name', ''))): row
        for _, row in players_df.iterrows()
    }
    window_by_id = {int(r['player_id']): r for _, r in window_df.iterrows()}

    items: list[MinutesMoverItem] = []
    for _, season_row in season_df.iterrows():
        player_id = int(season_row['player_id'])
        window_row = window_by_id.get(player_id)
        if window_row is None:
            continue

        season_gp = int(season_row['gp'])
        window_gp = int(window_row['gp'])
        if season_gp < MIN_SEASON_GP or window_gp < MIN_WINDOW_GP:
            continue

        player_name = str(season_row['player_name'])
        espn_row = espn_by_name.get(resolve_join_key(player_name))
        if espn_row is None:
            logger.warning(f"No ESPN roster match for '{player_name}' — skipped from Minutes Movers")
            continue

        season_mpg = season_row['min'] / season_gp if season_gp else 0.0
        window_mpg = window_row['min'] / window_gp if window_gp else 0.0
        fantasy_team_name = espn_row.get('fantasy_team_name')
        position = str(espn_row.get('Positions', 'Unknown')).split(',')[0].strip() or 'Unknown'

        items.append(MinutesMoverItem(
            player_name=player_name,
            pro_team=str(espn_row.get('Pro Team', 'Unknown')),
            position=position,
            fantasy_status=fantasy_team_name if isinstance(fantasy_team_name, str) and fantasy_team_name else 'FA',
            games_last_15d=games_last_15d.get(player_id, 0),
            season_mpg=season_mpg,
            l5_mpg=window_mpg,
            delta_mpg=window_mpg - season_mpg,
            season_gp=season_gp,
            window_gp=window_gp,
            low_sample=window_gp < LOW_SAMPLE_GP,
        ))

    items.sort(key=lambda i: abs(i.delta_mpg), reverse=True)
    return items


ROLE_MPG_THRESHOLD = 4.0
ROLE_USG_THRESHOLD = 2.0
USAGE_ONLY_THRESHOLD = 3.0


def classify_role_badge(delta_mpg: float, delta_usg: float) -> Optional[str]:
    """Role classification per trends_page_plan.md Section 2. Role beats
    Minutes/Usage-only when both cross their threshold together."""
    if delta_mpg >= ROLE_MPG_THRESHOLD and delta_usg >= ROLE_USG_THRESHOLD:
        return 'Role ↑'
    if delta_mpg >= ROLE_MPG_THRESHOLD:
        return 'Minutes ↑'
    if delta_usg >= USAGE_ONLY_THRESHOLD:
        return 'Usage ↑'
    if delta_mpg <= -ROLE_MPG_THRESHOLD and delta_usg <= -ROLE_USG_THRESHOLD:
        return 'Role ↓'
    if delta_mpg <= -ROLE_MPG_THRESHOLD:
        return 'Minutes ↓'
    if delta_usg <= -USAGE_ONLY_THRESHOLD:
        return 'Usage ↓'
    return None


def _usg_per_game(row) -> float:
    denom = row['p_min'] * (row['t_fga'] + 0.44 * row['t_fta'] + row['t_tov'])
    if denom == 0:
        return 0.0
    numerator = 100 * (row['p_fga'] + 0.44 * row['p_fta'] + row['p_tov']) * (row['t_min'] / 5)
    return numerator / denom


def compute_usage_role(
    games_df: pd.DataFrame,
    games_last_15d: dict[int, int],
    players_df: pd.DataFrame,
    window_start,
) -> list[UsageRoleItem]:
    """Pure calc: per-game USG% (never from summed totals) averaged over
    season vs the recency window (games with game_date >= window_start),
    combined with the same minutes delta as Minutes Movers, to classify role
    changes. No DB/network access."""
    if games_df.empty:
        return []

    espn_by_name = {
        resolve_join_key(str(row.get('Name', ''))): row
        for _, row in players_df.iterrows()
    }

    items: list[UsageRoleItem] = []
    for player_id, group in games_df.groupby('player_id'):
        season_gp = len(group)
        if season_gp < MIN_SEASON_GP:
            continue

        window_group = group[group['game_date'] >= window_start]
        window_gp = len(window_group)
        if window_gp < MIN_WINDOW_GP:
            continue

        player_name = str(group.iloc[0]['player_name'])
        espn_row = espn_by_name.get(resolve_join_key(player_name))
        if espn_row is None:
            logger.warning(f"No ESPN roster match for '{player_name}' — skipped from Usage & Role")
            continue

        usg_series = group.apply(_usg_per_game, axis=1)
        min_series = group['p_min']
        window_usg_series = window_group.apply(_usg_per_game, axis=1)
        window_min_series = window_group['p_min']

        season_usg = float(usg_series.mean())
        l5_usg = float(window_usg_series.mean())
        season_mpg = float(min_series.mean())
        l5_mpg = float(window_min_series.mean())
        delta_usg = l5_usg - season_usg
        delta_mpg = l5_mpg - season_mpg

        fantasy_team_name = espn_row.get('fantasy_team_name')
        position = str(espn_row.get('Positions', 'Unknown')).split(',')[0].strip() or 'Unknown'

        items.append(UsageRoleItem(
            player_name=player_name,
            pro_team=str(espn_row.get('Pro Team', 'Unknown')),
            position=position,
            fantasy_status=fantasy_team_name if isinstance(fantasy_team_name, str) and fantasy_team_name else 'FA',
            games_last_15d=games_last_15d.get(int(player_id), 0),
            season_usg=season_usg,
            l5_usg=l5_usg,
            delta_usg=delta_usg,
            season_mpg=season_mpg,
            l5_mpg=l5_mpg,
            delta_mpg=delta_mpg,
            season_gp=season_gp,
            window_gp=window_gp,
            role_badge=classify_role_badge(delta_mpg, delta_usg),
        ))

    items.sort(key=lambda i: abs(i.delta_usg), reverse=True)
    return items


def _normalize_window_days(window_days: int) -> int:
    return window_days if window_days in VALID_RECENCY_WINDOWS_DAYS else DEFAULT_RECENCY_WINDOW_DAYS


class TrendService:
    def __init__(self):
        self.logger = logging.getLogger(__name__)
        self._db = DBService()
        self._regression_cache: dict[int, dict] = {}
        self._minutes_cache: dict[int, dict] = {}
        self._usage_cache: dict[int, dict] = {}

    @staticmethod
    def _cache_valid(cache: dict, window_days: int) -> bool:
        entry = cache.get(window_days)
        return entry is not None and datetime.now() - entry['ts'] < _TREND_CACHE_TTL

    async def get_shooting_regression(self, players_df: pd.DataFrame, window_days: int = DEFAULT_RECENCY_WINDOW_DAYS) -> RegressionResponse:
        window_days = _normalize_window_days(window_days)
        if self._cache_valid(self._regression_cache, window_days):
            return self._regression_cache[window_days]['data']

        current_season = espn_season_string(settings.season_id)
        anchor_date = await get_season_anchor_date(current_season, self._db)
        prior_seasons = [
            espn_season_string(settings.season_id - 1),
            espn_season_string(settings.season_id - 2),
        ]

        current_df = await self._db.aggregate_shooting_by_player(
            [current_season], start=settings.season_start, end=anchor_date
        )
        baseline_df = await self._db.aggregate_shooting_by_player(prior_seasons)
        games_last_15d = await self._db.get_games_since(anchor_date - timedelta(days=window_days))

        groups = compute_regression_groups(current_df, baseline_df, games_last_15d, players_df)
        groups = [g for g in groups if g.fantasy_status == 'FA']
        response = RegressionResponse(items=groups, window_days=window_days, last_updated=datetime.now().isoformat())
        self._regression_cache[window_days] = {'data': response, 'ts': datetime.now()}
        return response

    async def get_minutes_movers(self, players_df: pd.DataFrame, window_days: int = DEFAULT_RECENCY_WINDOW_DAYS) -> MinutesResponse:
        window_days = _normalize_window_days(window_days)
        if self._cache_valid(self._minutes_cache, window_days):
            return self._minutes_cache[window_days]['data']

        current_season = espn_season_string(settings.season_id)
        anchor_date = await get_season_anchor_date(current_season, self._db)

        window_start = anchor_date - timedelta(days=window_days)
        season_df = await self._db.aggregate_shooting_by_player(
            [current_season], start=settings.season_start, end=anchor_date
        )
        window_df = await self._db.aggregate_shooting_by_player(
            [current_season], start=window_start, end=anchor_date
        )
        games_last_15d = await self._db.get_games_since(window_start)

        items = compute_minutes_movers(season_df, window_df, games_last_15d, players_df)
        items = [i for i in items if i.fantasy_status == 'FA']
        response = MinutesResponse(items=items, window_days=window_days, last_updated=datetime.now().isoformat())
        self._minutes_cache[window_days] = {'data': response, 'ts': datetime.now()}
        return response

    async def get_usage_role(self, players_df: pd.DataFrame, window_days: int = DEFAULT_RECENCY_WINDOW_DAYS) -> UsageResponse:
        window_days = _normalize_window_days(window_days)
        if self._cache_valid(self._usage_cache, window_days):
            return self._usage_cache[window_days]['data']

        current_season = espn_season_string(settings.season_id)
        anchor_date = await get_season_anchor_date(current_season, self._db)

        window_start = anchor_date - timedelta(days=window_days)
        games_df = await self._db.get_usage_components(current_season, settings.season_start, anchor_date)
        games_last_15d = await self._db.get_games_since(window_start)

        items = compute_usage_role(games_df, games_last_15d, players_df, window_start)
        items = [i for i in items if i.fantasy_status == 'FA']
        response = UsageResponse(items=items, window_days=window_days, last_updated=datetime.now().isoformat())
        self._usage_cache[window_days] = {'data': response, 'ts': datetime.now()}
        return response
