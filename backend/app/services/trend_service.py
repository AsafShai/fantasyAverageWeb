import logging
import math
from datetime import datetime, timedelta
from typing import Optional

import pandas as pd

from app.config import settings
from app.models.trend_models import (
    GameLogEntry,
    GameLogResponse,
    MinutesMoverItem,
    MinutesResponse,
    RegressionMode,
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
# baseline_min_att is stated per baseline season and multiplied by how many
# seasons the baseline spans — a 1-season baseline has half the attempts.
_STAT_SPECS = {
    '3P%': {'att': 'fg3a', 'mk': 'fg3m', 'pct': 'fg3_pct', 'current_min_att': 40, 'baseline_min_att_per_season': 75},
    'FT%': {'att': 'fta', 'mk': 'ftm', 'pct': 'ft_pct', 'current_min_att': 40, 'baseline_min_att_per_season': 75},
    'FG%': {'att': 'fga', 'mk': 'fgm', 'pct': 'fg_pct', 'current_min_att': 100, 'baseline_min_att_per_season': 150},
}

DEFAULT_BASELINE_SEASONS = 2
VALID_BASELINE_SEASONS = (1, 2)

DEFAULT_REGRESSION_MODE: RegressionMode = 'season'

# mode='form' gates. The z gate replaces a fixed attempt threshold: the same
# percentage-point gap is noise on 13 attempts and signal on 90, and free throws
# and field goals self-calibrate without a per-stat number to tune.
FORM_MIN_WINDOW_ATT = 10
FORM_MIN_BASELINE_ATT = 50
FORM_MIN_ABS_Z = 1.5


def _season_outlier_stat(
    stat_name: str,
    spec: dict,
    current_row,
    baseline_row,
    window_row,
    gp,
    baseline_seasons: int,
) -> Optional[RegressionStatItem]:
    """mode='season': this season to date vs prior seasons only."""
    current_att = current_row[spec['att']]
    baseline_att = baseline_row[spec['att']]
    min_baseline_att = spec['baseline_min_att_per_season'] * baseline_seasons
    if current_att < spec['current_min_att'] or baseline_att < min_baseline_att:
        return None
    current_pct = float(current_row[spec['pct']]) * 100
    baseline_pct = float(baseline_row[spec['pct']]) * 100
    dev = current_pct - baseline_pct
    attempts_per_game = float(current_att / gp) if gp else 0.0
    drift_score = attempts_per_game * abs(dev) / 100
    if drift_score < DRIFT_THRESHOLD:
        return None
    window_att = int(window_row[spec['att']]) if window_row is not None else 0
    return RegressionStatItem(
        stat=stat_name,
        current_pct=current_pct,
        baseline_pct=baseline_pct,
        dev=dev,
        attempts_per_game=attempts_per_game,
        drift_score=drift_score,
        window_pct=float(window_row[spec['pct']]) * 100 if window_att else None,
        window_attempts=window_att,
    )


def _form_stat(
    stat_name: str,
    spec: dict,
    current_row,
    baseline_row,
    window_row,
) -> Optional[RegressionStatItem]:
    """mode='form': the recency window vs a baseline of prior seasons plus this
    season before the window. The baseline shares no games with the window, so the
    two-proportion z-test below is valid — comparing the window against the whole
    season would compare a part to a whole containing it and shrink every gap."""
    att_win = int(window_row[spec['att']])
    mk_win = int(window_row[spec['mk']])
    att_pre = int(current_row[spec['att']]) - att_win
    mk_pre = int(current_row[spec['mk']]) - mk_win
    att_prior = int(baseline_row[spec['att']]) if baseline_row is not None else 0
    mk_prior = int(baseline_row[spec['mk']]) if baseline_row is not None else 0

    att_base = att_prior + att_pre
    mk_base = mk_prior + mk_pre
    if att_win < FORM_MIN_WINDOW_ATT or att_base < FORM_MIN_BASELINE_ATT:
        return None

    form_pct = mk_win / att_win * 100
    baseline_pct = mk_base / att_base * 100
    gap = form_pct - baseline_pct

    pooled = (mk_win + mk_base) / (att_win + att_base)
    se = math.sqrt(pooled * (1 - pooled) * (1 / att_win + 1 / att_base)) * 100
    if se <= 0:
        return None
    z = gap / se
    if abs(z) < FORM_MIN_ABS_Z:
        return None

    window_gp = int(window_row['gp'])
    return RegressionStatItem(
        stat=stat_name,
        current_pct=form_pct,
        baseline_pct=baseline_pct,
        dev=gap,
        attempts_per_game=att_win / window_gp if window_gp else 0.0,
        drift_score=abs(z),
        window_pct=form_pct,
        window_attempts=att_win,
        z=z,
    )


def compute_regression_groups(
    current_df: pd.DataFrame,
    baseline_df: pd.DataFrame,
    games_last_15d: dict[int, int],
    players_df: pd.DataFrame,
    baseline_seasons: int = DEFAULT_BASELINE_SEASONS,
    window_df: Optional[pd.DataFrame] = None,
    mode: RegressionMode = DEFAULT_REGRESSION_MODE,
) -> list[RegressionPlayerGroup]:
    """Pure calc: shooting deviation -> gated, player-grouped items. No DB/network
    access. mode='season' ranks season-vs-history outliers; mode='form' ranks
    significant hot/cold stretches inside the recency window."""
    if current_df.empty:
        return []
    if mode == 'season' and baseline_df.empty:
        return []

    espn_by_name = {
        resolve_join_key(str(row.get('Name', ''))): row
        for _, row in players_df.iterrows()
    }
    baseline_by_id = (
        {int(r['player_id']): r for _, r in baseline_df.iterrows()}
        if not baseline_df.empty else {}
    )
    window_by_id = (
        {int(r['player_id']): r for _, r in window_df.iterrows()}
        if window_df is not None and not window_df.empty else {}
    )

    groups: list[RegressionPlayerGroup] = []
    for _, current_row in current_df.iterrows():
        player_id = int(current_row['player_id'])
        baseline_row = baseline_by_id.get(player_id)
        window_row = window_by_id.get(player_id)
        if mode == 'season' and baseline_row is None:
            continue  # no prior seasons (rookie) -> nothing to deviate from
        if mode == 'form' and window_row is None:
            continue  # no games in the window -> no current form to judge

        gp = current_row['gp']
        stats: list[RegressionStatItem] = []
        for stat_name, spec in _STAT_SPECS.items():
            item = (
                _form_stat(stat_name, spec, current_row, baseline_row, window_row)
                if mode == 'form'
                else _season_outlier_stat(
                    stat_name, spec, current_row, baseline_row, window_row, gp, baseline_seasons
                )
            )
            if item is not None:
                stats.append(item)

        if not stats:
            continue

        player_name = str(current_row['player_name'])
        espn_row = espn_by_name.get(resolve_join_key(player_name))
        if espn_row is None:
            logger.warning(f"No ESPN roster match for '{player_name}' — skipped from Shooting Regression")
            continue

        stats.sort(key=(lambda s: s.drift_score) if mode == 'form' else (lambda s: abs(s.dev)), reverse=True)
        fantasy_team_name = espn_row.get('fantasy_team_name')
        position = str(espn_row.get('Positions', 'Unknown')).split(',')[0].strip() or 'Unknown'

        groups.append(RegressionPlayerGroup(
            player_id=player_id,
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
            player_id=player_id,
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
            player_id=int(player_id),
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


def _pct(makes, attempts) -> float:
    return float(makes) / float(attempts) * 100 if attempts else 0.0


def _player_pct_map(df: pd.DataFrame, player_id: int) -> dict[str, float]:
    """Attempt-weighted 3P%/FT%/FG% for one player out of an
    aggregate_shooting_by_player frame. Empty dict if the player isn't in it
    (rookie, or no prior-season rows)."""
    if df.empty:
        return {}
    rows = df[df['player_id'] == player_id]
    if rows.empty:
        return {}
    row = rows.iloc[0]
    return {name: float(row[spec['pct']]) * 100 for name, spec in _STAT_SPECS.items()}


def _league_pct_map(df: pd.DataFrame) -> dict[str, float]:
    """League-wide 3P%/FT%/FG% from an aggregate_shooting_by_player frame:
    every player's makes over every player's attempts. Answers 'is this player
    hurting the category', which his own history cannot."""
    if df.empty:
        return {}
    out: dict[str, float] = {}
    for name, spec in _STAT_SPECS.items():
        att = int(df[spec['att']].sum())
        if att:
            out[name] = int(df[spec['mk']].sum()) / att * 100
    return out


def _form_baseline_pct(
    baseline_df: pd.DataFrame,
    games_df: pd.DataFrame,
    player_id: int,
    window_start,
) -> dict[str, float]:
    """mode='form' baseline for the chart's reference line: prior seasons pooled
    with this season's games before the window. Excludes the window itself so the
    line the chart draws is the one the table's z-score was computed against."""
    prior = baseline_df[baseline_df['player_id'] == player_id] if not baseline_df.empty else baseline_df
    prior_row = prior.iloc[0] if not prior.empty else None
    pre = games_df[games_df['game_date'] < window_start]

    out: dict[str, float] = {}
    for name, spec in _STAT_SPECS.items():
        mk = int(pre[spec['mk']].sum())
        att = int(pre[spec['att']].sum())
        if prior_row is not None:
            mk += int(prior_row[spec['mk']])
            att += int(prior_row[spec['att']])
        if att:
            out[name] = mk / att * 100
    return out


def build_game_log(
    games_df: pd.DataFrame,
    player_id: int,
    season: str,
    window_days: int,
    window_start,
    baseline_pct: dict[str, float],
    baseline_seasons: int,
    league_pct: Optional[dict[str, float]] = None,
    league_usg: Optional[float] = None,
) -> GameLogResponse:
    """Pure calc: per-game rows -> chart-ready game log. USG% per game uses the
    same _usg_per_game as Usage & Role, so the chart's window mean equals the
    table's l5_usg by construction. No DB/network access."""
    usg_series = games_df.apply(_usg_per_game, axis=1)
    entries = [
        GameLogEntry(
            game_date=str(row['game_date']),
            matchup=str(row['matchup'] or ''),
            min=float(row['p_min']),
            usg=float(usg_series.iloc[i]),
            fgm=int(row['fgm']), fga=int(row['fga']),
            ftm=int(row['ftm']), fta=int(row['fta']),
            fg3m=int(row['fg3m']), fg3a=int(row['fg3a']),
        )
        for i, (_, row) in enumerate(games_df.iterrows())
    ]
    return GameLogResponse(
        player_id=player_id,
        player_name=str(games_df.iloc[0]['player_name']),
        season=season,
        window_days=window_days,
        window_start=str(window_start),
        season_gp=len(entries),
        season_mpg=float(games_df['p_min'].mean()),
        season_usg=float(usg_series.mean()),
        season_pct={
            '3P%': _pct(games_df['fg3m'].sum(), games_df['fg3a'].sum()),
            'FT%': _pct(games_df['ftm'].sum(), games_df['fta'].sum()),
            'FG%': _pct(games_df['fgm'].sum(), games_df['fga'].sum()),
        },
        baseline_pct=baseline_pct,
        league_pct=league_pct or {},
        league_usg=league_usg,
        baseline_seasons=baseline_seasons,
        games=entries,
    )


def _normalize_window_days(window_days: int) -> int:
    return window_days if window_days in VALID_RECENCY_WINDOWS_DAYS else DEFAULT_RECENCY_WINDOW_DAYS


def _normalize_baseline_seasons(baseline_seasons: int) -> int:
    return baseline_seasons if baseline_seasons in VALID_BASELINE_SEASONS else DEFAULT_BASELINE_SEASONS


def prior_season_strings(baseline_seasons: int) -> list[str]:
    return [espn_season_string(settings.season_id - n) for n in range(1, baseline_seasons + 1)]


class TrendService:
    def __init__(self):
        self.logger = logging.getLogger(__name__)
        self._db = DBService()
        self._regression_cache: dict[tuple[int, int, str], dict] = {}
        self._minutes_cache: dict[int, dict] = {}
        self._usage_cache: dict[int, dict] = {}
        self._game_log_cache: dict[tuple[int, int, int, str], dict] = {}
        self._league_cache: dict[str, dict] = {}

    @staticmethod
    def _cache_valid(cache: dict, key) -> bool:
        entry = cache.get(key)
        return entry is not None and datetime.now() - entry['ts'] < _TREND_CACHE_TTL

    async def get_shooting_regression(
        self,
        players_df: pd.DataFrame,
        window_days: int = DEFAULT_RECENCY_WINDOW_DAYS,
        baseline_seasons: int = DEFAULT_BASELINE_SEASONS,
        mode: RegressionMode = DEFAULT_REGRESSION_MODE,
    ) -> RegressionResponse:
        window_days = _normalize_window_days(window_days)
        baseline_seasons = _normalize_baseline_seasons(baseline_seasons)
        cache_key = (window_days, baseline_seasons, mode)
        if self._cache_valid(self._regression_cache, cache_key):
            return self._regression_cache[cache_key]['data']

        current_season = espn_season_string(settings.season_id)
        anchor_date = await get_season_anchor_date(current_season, self._db)

        window_start = anchor_date - timedelta(days=window_days)
        current_df = await self._db.aggregate_shooting_by_player(
            [current_season], start=settings.season_start, end=anchor_date
        )
        window_df = await self._db.aggregate_shooting_by_player(
            [current_season], start=window_start, end=anchor_date
        )
        baseline_df = await self._db.aggregate_shooting_by_player(prior_season_strings(baseline_seasons))
        games_last_15d = await self._db.get_games_since(window_start)

        groups = compute_regression_groups(
            current_df, baseline_df, games_last_15d, players_df, baseline_seasons, window_df, mode
        )
        response = RegressionResponse(
            items=groups,
            window_days=window_days,
            baseline_seasons=baseline_seasons,
            mode=mode,
            last_updated=datetime.now().isoformat(),
        )
        self._regression_cache[cache_key] = {'data': response, 'ts': datetime.now()}
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
        response = UsageResponse(items=items, window_days=window_days, last_updated=datetime.now().isoformat())
        self._usage_cache[window_days] = {'data': response, 'ts': datetime.now()}
        return response

    async def _get_league_refs(self, season: str, end) -> tuple[dict[str, float], Optional[float]]:
        """League-wide shooting pcts and USG%, cached together — one pull serves
        every player's chart. USG% lands at ~20 by construction (five players
        split 100% of possessions), which is exactly why it is a useful anchor
        for judging whether a given usage is high."""
        if self._cache_valid(self._league_cache, season):
            entry = self._league_cache[season]['data']
            return entry['pct'], entry['usg']

        shooting_df = await self._db.aggregate_shooting_by_player(
            [season], start=settings.season_start, end=end
        )
        usage_df = await self._db.get_usage_components(season, settings.season_start, end)
        league_usg = None
        if not usage_df.empty:
            usg = usage_df.apply(_usg_per_game, axis=1)
            total_min = usage_df['p_min'].sum()
            if total_min:
                league_usg = float((usg * usage_df['p_min']).sum() / total_min)

        data = {'pct': _league_pct_map(shooting_df), 'usg': league_usg}
        self._league_cache[season] = {'data': data, 'ts': datetime.now()}
        return data['pct'], data['usg']

    async def get_player_game_log(
        self,
        player_id: int,
        window_days: int = DEFAULT_RECENCY_WINDOW_DAYS,
        baseline_seasons: int = DEFAULT_BASELINE_SEASONS,
        mode: RegressionMode = DEFAULT_REGRESSION_MODE,
    ) -> Optional[GameLogResponse]:
        window_days = _normalize_window_days(window_days)
        baseline_seasons = _normalize_baseline_seasons(baseline_seasons)
        cache_key = (player_id, window_days, baseline_seasons, mode)
        if self._cache_valid(self._game_log_cache, cache_key):
            return self._game_log_cache[cache_key]['data']

        current_season = espn_season_string(settings.season_id)
        anchor_date = await get_season_anchor_date(current_season, self._db)
        window_start = anchor_date - timedelta(days=window_days)

        games_df = await self._db.get_player_game_log(
            player_id, current_season, settings.season_start, anchor_date
        )
        if games_df.empty:
            return None

        baseline_df = await self._db.aggregate_shooting_by_player(prior_season_strings(baseline_seasons))
        baseline_pct = (
            _form_baseline_pct(baseline_df, games_df, player_id, window_start)
            if mode == 'form'
            else _player_pct_map(baseline_df, player_id)
        )

        league_pct, league_usg = await self._get_league_refs(current_season, anchor_date)

        response = build_game_log(
            games_df, player_id, current_season, window_days, window_start,
            baseline_pct, baseline_seasons, league_pct, league_usg,
        )
        self._game_log_cache[cache_key] = {'data': response, 'ts': datetime.now()}
        return response
