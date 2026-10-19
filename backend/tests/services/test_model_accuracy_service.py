from contextlib import asynccontextmanager
from datetime import date, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

import pandas as pd
import pytest

from app.services import model_accuracy_service as svc
from app.services.nba_matchup_service import GameInfo
from app.utils.name_matching import normalize_player_name

STATS = {
    'pts': 25.7, 'reb': 6.1, 'ast': 9.2, 'three_pm': 2.2, 'stl': 1.1, 'blk': 0.6,
    'fgm': 9.4, 'fga': 20.8, 'fg_pct': 0.452, 'ftm': 5.1, 'fta': 5.9, 'ft_pct': 0.864,
}


def _proj(pid: int, status: str = 'green', stats=STATS) -> dict:
    return {'default_minutes': 34.9, 'status': status, 'reason': '', 'stats': stats, 'player_id': pid}


@pytest.fixture(autouse=True)
def _reset():
    svc._recorded.clear()
    svc.invalidate_cache()
    yield
    svc._recorded.clear()
    svc.invalidate_cache()


def test_build_snapshot_rows_keeps_only_pregame_projected_players():
    players = pd.DataFrame([
        {'Name': 'Cade Cunningham', 'Pro Team': 'DET'},
        {'Name': 'Jalen Brunson', 'Pro Team': 'NYK'},      # game already tipped off
        {'Name': 'Thin History', 'Pro Team': 'DET'},       # red: no projection shown
        {'Name': 'Idle Player', 'Pro Team': 'BOS'},        # no game
    ])
    games = {
        'DET': GameInfo(opponent='NYK', is_home=True),
        'NYK': GameInfo(opponent='DET', is_home=False, pregame=False),
    }
    projections = {
        'Cade Cunningham': _proj(4432166),
        'Jalen Brunson': _proj(3934672),
        'Thin History': {'default_minutes': 5.0, 'status': 'red', 'reason': 'x', 'stats': None, 'player_id': 9},
    }
    rows = svc.build_snapshot_rows(
        players, games, projections, {normalize_player_name('Cade Cunningham'): 'Questionable'},
        {4432166: {'min': 33.0, **{s: 1.0 for s in svc.metrics.STATS}}},
        date(2026, 12, 8), date(2026, 12, 7),
    )
    assert len(rows) == 1
    row = dict(zip(svc._SNAPSHOT_COLS, rows[0]))
    assert row['player_id'] == 4432166
    assert row['team_id'] == 8 and row['opponent_team_id'] == 18 and row['is_home'] is True
    assert row['proj_min'] == 34.9
    assert row['injury_status'] == 'Questionable'
    assert row['pred_fg3m'] == 2.2 and row['pred_fg_pct'] == 0.452
    assert row['base_min'] == 33.0 and row['base_pts'] == 1.0
    assert row['store_through'] == date(2026, 12, 7)


def _fake_pool(conn):
    pool = MagicMock()

    @asynccontextmanager
    async def acquire():
        yield conn
    pool.acquire = acquire
    return pool


@pytest.mark.asyncio
async def test_record_pregame_snapshot_writes_once_per_store_state():
    conn = MagicMock()
    conn.fetchval = AsyncMock(return_value=date(2026, 12, 7))
    conn.fetch = AsyncMock(return_value=[])
    conn.executemany = AsyncMock()
    players = pd.DataFrame([{'Name': 'Cade Cunningham', 'Pro Team': 'DET'}])
    games = {'DET': GameInfo(opponent='NYK', is_home=True)}
    tomorrow = svc._today_et() + timedelta(days=1)

    with patch.object(svc, '_pool', AsyncMock(return_value=_fake_pool(conn))):
        assert await svc.record_pregame_snapshot(players, games, {'Cade Cunningham': _proj(1)}, {}, tomorrow) == 1
        # Same slate, same store: /matchups rebuilds must not re-insert.
        assert await svc.record_pregame_snapshot(players, games, {'Cade Cunningham': _proj(1)}, {}, tomorrow) == 0

    assert conn.executemany.await_count == 1
    sql = conn.executemany.await_args.args[0]
    assert 'ON CONFLICT (game_date, player_id) DO UPDATE' in sql
    assert 'EXCLUDED.store_through > model_pregame_projections.store_through' in sql
    assert 'reconciled_at IS NULL' in sql


@pytest.mark.asyncio
async def test_record_pregame_snapshot_never_writes_past_slates():
    pool = AsyncMock()
    with patch.object(svc, '_pool', pool):
        written = await svc.record_pregame_snapshot(
            pd.DataFrame(), {}, {'x': _proj(1)}, {}, svc._today_et() - timedelta(days=1),
        )
    assert written == 0
    pool.assert_not_awaited()


@pytest.mark.asyncio
async def test_reconcile_counts_updates_and_invalidates_cache():
    conn = MagicMock()
    conn.execute = AsyncMock(side_effect=['UPDATE 7', 'UPDATE 2', 'UPDATE 0'])

    @asynccontextmanager
    async def tx():
        yield
    conn.transaction = tx
    svc._cache[('players',)] = (0.0, {'players': []})

    with patch.object(svc, '_pool', AsyncMock(return_value=_fake_pool(conn))):
        assert await svc.reconcile_pending() == 9

    assert svc._cache == {}
    played_sql = conn.execute.await_args_list[0].args[0]
    assert "CASE WHEN g.min > 0 THEN 'played' ELSE 'dnp' END" in played_sql
    assert 'team_margin = tg.pts - og.pts' in played_sql


@pytest.mark.asyncio
async def test_summary_empty_before_any_graded_game():
    with (
        patch.object(svc, '_latest_date', AsyncMock(return_value=None)),
        patch.object(svc, '_first_snapshot_date', AsyncMock(return_value=date(2026, 10, 21))),
    ):
        out = await svc.summary('pregame', 'season')
    assert out['games'] == 0 and out['categories'] == []
    assert out['first_snapshot_date'] == '2026-10-21'


@pytest.mark.asyncio
async def test_summary_pregame_includes_minutes_and_is_cached():
    from tests.services.test_model_accuracy_metrics import _row

    frame = pd.DataFrame([_row(actual_pts=9.0), _row(outcome='dnp')])
    fetch = AsyncMock(return_value=frame)
    with (
        patch.object(svc, '_latest_date', AsyncMock(return_value=date(2026, 12, 10))),
        patch.object(svc, '_first_snapshot_date', AsyncMock(return_value=date(2026, 10, 21))),
        patch.object(svc, '_fetch_pregame', fetch),
    ):
        out = await svc.summary('pregame', 'week')
        again = await svc.summary('pregame', 'week')

    assert again is out
    fetch.assert_awaited_once_with(date(2026, 12, 7), date(2026, 12, 10))
    assert out['games'] == 1 and out['dnp'] == 1
    assert out['minutes']['key'] == 'min'
    pts = next(c for c in out['categories'] if c['key'] == 'pts')
    assert pts['model_mae'] == 4.0


@pytest.mark.asyncio
async def test_summary_retro_has_no_minutes():
    from tests.services.test_model_accuracy_metrics import _row

    with (
        patch.object(svc, '_latest_date', AsyncMock(return_value=date(2026, 12, 10))),
        patch.object(svc, '_first_snapshot_date', AsyncMock(return_value=None)),
        patch.object(svc, '_fetch_retro', AsyncMock(return_value=pd.DataFrame([_row()]))),
    ):
        out = await svc.summary('retro', 'season')
    assert out['minutes'] is None and out['games'] == 1


@pytest.mark.asyncio
async def test_empty_result_from_unreachable_db_is_not_cached():
    # DB down: the page gets the empty summary, but the next request retries
    # instead of serving "no data" for the whole TTL.
    with patch.object(svc, '_pool', AsyncMock(return_value=None)):
        out = await svc.summary('pregame', 'season')
    assert out['games'] == 0
    assert svc._cache == {}

    with (
        patch.object(svc, '_latest_date', AsyncMock(return_value=None)),
        patch.object(svc, '_first_snapshot_date', AsyncMock(return_value=None)),
    ):
        await svc.summary('pregame', 'season')
    # A genuinely empty result (DB reachable, nothing graded) is cached.
    assert ('summary', 'pregame', 'season') in svc._cache
