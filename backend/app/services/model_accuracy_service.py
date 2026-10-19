"""Model vs. Reality: pre-game projection snapshots, the nightly join with
actuals, and the read side behind /api/model-accuracy.

Why a snapshot at all: model_eval_results is retro — re-predicted with the
minutes the player actually played — so it can't say how good the projection
users saw before tip-off was. The shown projection is
LiveProjectionService.project_today() at default minutes, which only changes
when the morning nightly run refreshes the store, so recording it once per
(game_date, player) — and again only if a newer store produced it — captures
exactly what the Projections page and player card showed.

Writers: the morning scheduler (after run_catchup) and /matchups/today's slate
build, both through record_pregame_snapshot. Only games ESPN still reports as
'pre' are written, so a projection is never recorded after tip-off.
"""

from __future__ import annotations

import hashlib
import logging
import time
from datetime import date, datetime, timedelta
from typing import Optional
from zoneinfo import ZoneInfo

import pandas as pd

from app.services import model_accuracy_metrics as metrics
from app.services.db_service import DBService
from app.services.nba_matchup_service import GameInfo
from app.utils.name_matching import normalize_player_name
from app.utils.team_abbr_map import team_id_for_abbr
from model_stats_inference.serving import config as serving_config

logger = logging.getLogger(__name__)

_MISSING_TABLE_HINT = 'apply migrations/create_model_pregame_projections.sql'

_PRED_KEYS = {
    'pts': 'pts', 'reb': 'reb', 'ast': 'ast', 'fg3m': 'three_pm', 'stl': 'stl', 'blk': 'blk',
    'fgm': 'fgm', 'fga': 'fga', 'ftm': 'ftm', 'fta': 'fta', 'fg_pct': 'fg_pct', 'ft_pct': 'ft_pct',
}
_SNAPSHOT_COLS = (
    ['game_date', 'player_id', 'player_name', 'team_id', 'opponent_team_id', 'is_home',
     'proj_min', 'status', 'status_reason', 'injury_status']
    + [f'pred_{k}' for k in _PRED_KEYS]
    + ['base_min'] + [f'base_{s}' for s in metrics.STATS]
    + ['store_through', 'model_version']
)

# Retro baselines need up to 10 earlier games per player before the window opens.
_RETRO_LOOKBACK_DAYS = 60
_CACHE_TTL_S = 600

# (game_date, store_through) slates already written this process: /matchups
# rebuilds every few minutes and must not re-insert the same slate each time.
_recorded: set[tuple[date, Optional[date]]] = set()
_cache: dict[tuple, tuple[float, object]] = {}
_model_version: Optional[str] = None


def _today_et() -> date:
    return datetime.now(ZoneInfo('America/New_York')).date()


def model_version() -> str:
    global _model_version
    if _model_version is None:
        try:
            raw = (serving_config.MODELS_DIR / 'model_card.json').read_bytes()
            _model_version = hashlib.sha256(raw).hexdigest()[:12]
        except OSError:
            _model_version = ''
    return _model_version


def invalidate_cache() -> None:
    _cache.clear()


async def _pool():
    return await DBService()._get_pool()


# --- write side ---------------------------------------------------------------

def build_snapshot_rows(
    players_df: pd.DataFrame,
    games: dict[str, GameInfo],
    projections: dict[str, dict],
    injury_lookup: dict[str, str],
    baselines: dict[int, dict],
    game_date: date,
    store_through: Optional[date],
) -> list[tuple]:
    """Tuples in _SNAPSHOT_COLS order for every player with a projection whose
    game has not tipped off. Players without a usable projection (red status,
    no stats) are skipped — there was nothing to show, so nothing to grade."""
    rows = []
    version = model_version()
    for row in players_df.to_dict('records'):
        name = str(row.get('Name', ''))
        pro_team = str(row.get('Pro Team', ''))
        info = games.get(pro_team)
        proj = projections.get(name)
        if info is None or not info.pregame or proj is None or not proj.get('stats'):
            continue
        pid = proj.get('player_id')
        team_id = team_id_for_abbr(pro_team)
        opp_id = team_id_for_abbr(info.opponent)
        if pid is None or team_id is None or opp_id is None:
            continue
        stats = proj['stats']
        base = baselines.get(int(pid), {})
        rows.append((
            game_date, int(pid), name, team_id, opp_id, info.is_home,
            float(proj['default_minutes']), proj['status'], proj.get('reason', ''),
            injury_lookup.get(normalize_player_name(name)),
            *[float(stats[k]) for k in _PRED_KEYS.values()],
            base.get('min'), *[base.get(s) for s in metrics.STATS],
            store_through, version,
        ))
    return rows


async def _last10_baselines(conn, player_ids: list[int]) -> dict[int, dict]:
    rows = await conn.fetch(
        f"""
        SELECT player_id, AVG(min) AS min, {', '.join(f'AVG({s}) AS {s}' for s in metrics.STATS)}
        FROM (
            SELECT *, ROW_NUMBER() OVER (
                PARTITION BY player_id ORDER BY game_date DESC, game_id DESC
            ) AS rn
            FROM fs_player_games
            WHERE player_id = ANY($1::bigint[]) AND min > 0
        ) t WHERE rn <= 10
        GROUP BY player_id
        """,
        player_ids,
    )
    return {int(r['player_id']): {k: float(v) for k, v in dict(r).items() if k != 'player_id'} for r in rows}


async def record_pregame_snapshot(
    players_df: pd.DataFrame,
    games: dict[str, GameInfo],
    projections: dict[str, dict],
    injury_lookup: dict[str, str],
    game_date: date,
) -> int:
    """Persist the slate's projections as shown. First write wins; a later write
    replaces a row only when a newer store produced it and the game hasn't been
    reconciled. Returns rows offered (0 when skipped)."""
    if game_date < _today_et() or not projections:
        return 0
    pool = await _pool()
    if pool is None:
        return 0
    try:
        async with pool.acquire() as conn:
            store_through = await conn.fetchval('SELECT MAX(game_date) FROM fs_team_games')
            key = (game_date, store_through)
            if key in _recorded:
                return 0
            pids = [int(p['player_id']) for p in projections.values() if p.get('player_id') is not None]
            baselines = await _last10_baselines(conn, pids)
            rows = build_snapshot_rows(players_df, games, projections, injury_lookup, baselines, game_date, store_through)
            if not rows:
                return 0
            keep = ('game_date', 'player_id')
            updates = ', '.join(f'{c} = EXCLUDED.{c}' for c in _SNAPSHOT_COLS if c not in keep)
            await conn.executemany(
                f"INSERT INTO model_pregame_projections ({', '.join(_SNAPSHOT_COLS)}, snapshot_at) "
                f"VALUES ({', '.join(f'${i + 1}' for i in range(len(_SNAPSHOT_COLS)))}, NOW()) "
                f"ON CONFLICT (game_date, player_id) DO UPDATE SET {updates}, snapshot_at = NOW() "
                "WHERE model_pregame_projections.reconciled_at IS NULL "
                "AND EXCLUDED.store_through > model_pregame_projections.store_through",
                rows,
            )
        _recorded.add(key)
        logger.info(f'Pre-game snapshot {game_date}: {len(rows)} projections (store through {store_through})')
        return len(rows)
    except Exception as e:
        logger.error(f'Failed to record pre-game snapshot for {game_date}: {type(e).__name__}: {e} ({_MISSING_TABLE_HINT} if missing)')
        return 0


async def snapshot_upcoming_slate() -> int:
    """Morning-scheduler entry: project the default (upcoming) slate exactly as
    /matchups/today would and record it."""
    # Imported here: these pull in the model and ESPN clients, which the read
    # side of this module (and its tests) never need.
    from app.services.data_provider import DataProvider
    from app.services.live_projection_service import LiveProjectionService
    from app.services.nba_matchup_service import get_shared_matchup_service

    matchups = get_shared_matchup_service()
    games = await matchups.get_games_today()
    resolved = matchups.get_schedule_date()
    if not games or not resolved:
        return 0
    players_df = await DataProvider().get_players_df(stat_split_type_id=0)
    injuries = await DBService().load_all_injury_statuses()
    projections = await LiveProjectionService().project_today(players_df, games)
    lookup = {normalize_player_name(r['player']): r['status'] for r in injuries}
    return await record_pregame_snapshot(players_df, games, projections, lookup, date.fromisoformat(resolved))


_RECONCILE_PLAYED = f"""
UPDATE model_pregame_projections p SET
    game_id = g.game_id,
    outcome = CASE WHEN g.min > 0 THEN 'played' ELSE 'dnp' END,
    actual_min = g.min,
    {', '.join(f'actual_{s} = g.{s}' for s in metrics.STATS)},
    actual_pf = g.pf,
    team_margin = tg.pts - og.pts,
    reconciled_at = NOW()
FROM fs_player_games g
JOIN fs_team_games tg ON tg.game_id = g.game_id AND tg.team_id = g.team_id
JOIN fs_team_games og ON og.game_id = g.game_id AND og.team_id <> g.team_id
WHERE p.reconciled_at IS NULL
  AND g.player_id = p.player_id AND g.game_date = p.game_date
"""

# The night is ingested, the team played, the player has no row: did not play.
_RECONCILE_DNP = """
UPDATE model_pregame_projections p SET
    game_id = tg.game_id,
    outcome = 'dnp',
    actual_min = 0,
    team_margin = tg.pts - og.pts,
    reconciled_at = NOW()
FROM fs_team_games tg
JOIN fs_team_games og ON og.game_id = tg.game_id AND og.team_id <> tg.team_id
WHERE p.reconciled_at IS NULL
  AND tg.team_id = p.team_id AND tg.game_date = p.game_date
"""

# The night is sealed in the ledger but the team has no game (postponed, or
# traded before tip and the new team's row is under another date).
_RECONCILE_NO_GAME = """
UPDATE model_pregame_projections p SET outcome = 'no_game', reconciled_at = NOW()
WHERE p.reconciled_at IS NULL
  AND EXISTS (SELECT 1 FROM model_nightly_runs r WHERE r.game_date = p.game_date)
"""


async def reconcile_pending() -> int:
    """Join every unreconciled snapshot whose night is ingested with its box
    score. Idempotent: only touches rows with reconciled_at IS NULL, and a
    night that isn't in the store yet simply matches nothing."""
    pool = await _pool()
    if pool is None:
        return 0
    try:
        async with pool.acquire() as conn:
            async with conn.transaction():
                total = 0
                for sql in (_RECONCILE_PLAYED, _RECONCILE_DNP, _RECONCILE_NO_GAME):
                    status = await conn.execute(sql)
                    total += int(status.split()[-1])
        if total:
            invalidate_cache()
            logger.info(f'Reconciled {total} pre-game projections with actuals')
        return total
    except Exception as e:
        logger.error(f'Failed to reconcile pre-game projections: {type(e).__name__}: {e} ({_MISSING_TABLE_HINT} if missing)')
        return 0


# --- read side ----------------------------------------------------------------

async def _fetch_pregame(start: Optional[date] = None, end: Optional[date] = None, player_id: Optional[int] = None) -> pd.DataFrame:
    pool = await _pool()
    if pool is None:
        return pd.DataFrame()
    clauses, args = ["outcome IN ('played', 'dnp')"], []
    if start is not None:
        args.append(start)
        clauses.append(f'game_date >= ${len(args)}')
    if end is not None:
        args.append(end)
        clauses.append(f'game_date <= ${len(args)}')
    if player_id is not None:
        args.append(player_id)
        clauses.append(f'player_id = ${len(args)}')
    try:
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                f"SELECT * FROM model_pregame_projections WHERE {' AND '.join(clauses)} ORDER BY game_date",
                *args,
            )
    except Exception as e:
        logger.error(f'Failed to read pre-game projections: {type(e).__name__}: {e} ({_MISSING_TABLE_HINT} if missing)')
        return pd.DataFrame()
    return _frame([dict(r) for r in rows])


async def _fetch_retro(start: date, end: date) -> pd.DataFrame:
    pool = await _pool()
    if pool is None:
        return pd.DataFrame()
    try:
        async with pool.acquire() as conn:
            evals = await conn.fetch(
                'SELECT * FROM model_eval_results WHERE eligible AND game_date BETWEEN $1 AND $2',
                start, end,
            )
            if not evals:
                return pd.DataFrame()
            fs = await conn.fetch(
                f"SELECT player_id, game_id, game_date, min, {', '.join(metrics.STATS)} FROM fs_player_games "
                'WHERE game_date BETWEEN $1 AND $2 AND player_id = ANY($3::bigint[])',
                start - timedelta(days=_RETRO_LOOKBACK_DAYS), end,
                list({int(r['player_id']) for r in evals}),
            )
    except Exception as e:
        logger.error(f'Failed to read retro eval rows: {type(e).__name__}: {e}')
        return pd.DataFrame()
    frame = metrics.retro_frame(_frame([dict(r) for r in evals]), pd.DataFrame([dict(r) for r in fs]))
    return frame


def _frame(records: list[dict]) -> pd.DataFrame:
    df = pd.DataFrame(records)
    if df.empty:
        return df
    # asyncpg hands back None for NULL; numeric NaN keeps the pandas math simple.
    for col in df.columns:
        if col.startswith(('pred_', 'base_', 'actual_', 'proj_')) or col in ('minutes', 'team_margin'):
            df[col] = pd.to_numeric(df[col], errors='coerce')
    return df


async def _latest_date(mode: str) -> Optional[date]:
    pool = await _pool()
    if pool is None:
        return None
    sql = (
        "SELECT MAX(game_date) FROM model_pregame_projections WHERE outcome IN ('played', 'dnp')"
        if mode == 'pregame'
        else 'SELECT MAX(game_date) FROM model_eval_results WHERE eligible'
    )
    try:
        async with pool.acquire() as conn:
            return await conn.fetchval(sql)
    except Exception as e:
        logger.error(f'Failed to read latest {mode} date: {type(e).__name__}: {e}')
        return None


async def _first_snapshot_date() -> Optional[date]:
    pool = await _pool()
    if pool is None:
        return None
    try:
        async with pool.acquire() as conn:
            return await conn.fetchval('SELECT MIN(game_date) FROM model_pregame_projections')
    except Exception:
        return None


async def _cached(key: tuple, build):
    hit = _cache.get(key)
    if hit is not None and time.monotonic() - hit[0] < _CACHE_TTL_S:
        return hit[1]
    value = await build()
    _cache[key] = (time.monotonic(), value)
    return value


async def _frame_for(mode: str, start: date, end: date) -> pd.DataFrame:
    return await (_fetch_pregame(start, end) if mode == 'pregame' else _fetch_retro(start, end))


async def summary(mode: str, window: str) -> dict:
    async def build() -> dict:
        latest = await _latest_date(mode)
        first = await _first_snapshot_date()
        empty = {
            'mode': mode, 'window': window, 'start': None, 'end': None, 'games': 0, 'dnp': 0,
            'categories': [], 'minutes': None, 'first_snapshot_date': first.isoformat() if first else None,
        }
        if latest is None:
            return empty
        start, end = metrics.window_bounds(window, latest)
        df = await _frame_for(mode, start, end)
        if df.empty:
            return {**empty, 'start': start.isoformat(), 'end': end.isoformat()}
        return {
            **empty,
            'start': start.isoformat(),
            'end': end.isoformat(),
            'games': int((df['outcome'] == 'played').sum()),
            'dnp': int((df['outcome'] == 'dnp').sum()),
            'categories': metrics.category_summary(df),
            'minutes': metrics.minutes_summary(df) if mode == 'pregame' else None,
        }
    return await _cached(('summary', mode, window), build)


async def weekly(mode: str) -> dict:
    async def build() -> dict:
        latest = await _latest_date(mode)
        if latest is None:
            return {'mode': mode, 'weeks': []}
        df = await _frame_for(mode, metrics.season_start_for(latest), latest)
        return {'mode': mode, 'weeks': metrics.weekly(df) if not df.empty else []}
    return await _cached(('weekly', mode), build)


async def misses(week: Optional[date]) -> dict:
    async def build() -> dict:
        if week is None:
            latest = await _latest_date('pregame')
            if latest is None:
                return {'week_start': None, 'misses': [], 'didnt_play': [], 'didnt_play_count': 0}
            start = metrics.week_start(latest)
        else:
            start = metrics.week_start(week)
        df = await _fetch_pregame(start, start + timedelta(days=6))
        return {
            'week_start': start.isoformat(),
            'misses': metrics.biggest_misses(df),
            'didnt_play': metrics.didnt_play(df),
            'didnt_play_count': int((df['outcome'] == 'dnp').sum()) if not df.empty else 0,
        }
    return await _cached(('misses', week), build)


async def players() -> dict:
    async def build() -> dict:
        latest = await _latest_date('pregame')
        if latest is None:
            return {'players': []}
        df = await _fetch_pregame(latest - timedelta(days=45), latest)
        return {'players': metrics.player_rows(df)}
    return await _cached(('players',), build)


async def player(player_id: int) -> Optional[dict]:
    async def build() -> Optional[dict]:
        df = await _fetch_pregame(player_id=player_id)
        if df.empty:
            return None
        detail = metrics.player_detail(df)
        if detail is None:
            return None
        return {'player_id': player_id, 'player_name': str(df['player_name'].iloc[-1]), **detail}
    return await _cached(('player', player_id), build)
