"""Migration + snapshot + nightly-join SQL against a real Postgres.

Opt-in: set TEST_DATABASE_URL to a throwaway database (the test creates and
drops its own schema). Skipped otherwise, since CI has no database.
"""

import os
import uuid
from datetime import date, timedelta
from pathlib import Path
from unittest.mock import patch

import pandas as pd
import pytest
import pytest_asyncio

from app.services import model_accuracy_service as svc
from app.services.nba_matchup_service import GameInfo

DB_URL = os.environ.get('TEST_DATABASE_URL')
pytestmark = [pytest.mark.skipif(not DB_URL, reason='TEST_DATABASE_URL not set'), pytest.mark.asyncio]

MIGRATIONS = Path(__file__).resolve().parents[2] / 'migrations'
STAT_COLS = ['pts', 'reb', 'oreb', 'dreb', 'ast', 'fg3m', 'fg3a', 'stl', 'blk', 'tov', 'fgm', 'fga', 'ftm', 'fta', 'pf', 'plus_minus']


@pytest_asyncio.fixture
async def pool():
    asyncpg = pytest.importorskip('asyncpg')
    schema = f'acc_{uuid.uuid4().hex[:8]}'
    admin = await asyncpg.connect(DB_URL)
    await admin.execute(f'CREATE SCHEMA {schema}')
    p = await asyncpg.create_pool(DB_URL, min_size=1, max_size=2, server_settings={'search_path': schema})
    async with p.acquire() as conn:
        for name in ('create_model_pipeline_tables.sql', 'create_model_pregame_projections.sql'):
            await conn.execute((MIGRATIONS / name).read_text())
    svc._recorded.clear()
    svc.invalidate_cache()
    try:
        yield p
    finally:
        await p.close()
        await admin.execute(f'DROP SCHEMA {schema} CASCADE')
        await admin.close()


async def _player_game(conn, pid, game_id, day, team_id, minutes, **stats):
    row = {c: 0.0 for c in STAT_COLS} | stats
    await conn.execute(
        f"INSERT INTO fs_player_games (player_id, game_id, season, game_date, team_id, min, {', '.join(STAT_COLS)}) "
        f"VALUES ($1, $2, '2026-27', $3, $4, $5, {', '.join(f'${i + 6}' for i in range(len(STAT_COLS)))})",
        pid, game_id, day, team_id, minutes, *[row[c] for c in STAT_COLS],
    )


async def _team_game(conn, team_id, game_id, day, pts):
    await conn.execute(
        "INSERT INTO fs_team_games (team_id, game_id, season, game_date, pts, reb, ast, stl, blk, fg3m, fg_pct, fga, fta, tov) "
        "VALUES ($1, $2, '2026-27', $3, $4, 0, 0, 0, 0, 0, 0, 0, 0, 0)",
        team_id, game_id, day, pts,
    )


def _proj(pid, minutes=34.0, pts=25.0):
    stats = {'pts': pts, 'reb': 6.0, 'ast': 9.0, 'three_pm': 2.0, 'stl': 1.0, 'blk': 0.5,
             'fgm': 9.0, 'fga': 20.0, 'fg_pct': 0.45, 'ftm': 5.0, 'fta': 6.0, 'ft_pct': 0.83}
    return {'default_minutes': minutes, 'status': 'green', 'reason': '', 'stats': stats, 'player_id': pid}


async def test_snapshot_then_reconcile_played_dnp_and_no_game(pool):
    day = date(2026, 12, 8)
    prior = day - timedelta(days=2)
    async with pool.acquire() as conn:
        # History for the last-10 baseline, and the store's newest night.
        await _player_game(conn, 1, 'g0', prior, 8, 30.0, pts=20.0)
        await _team_game(conn, 8, 'g0', prior, 100)
        await _team_game(conn, 18, 'g0', prior, 90)

    players = pd.DataFrame([
        {'Name': 'Played Guy', 'Pro Team': 'DET'},
        {'Name': 'Sat Guy', 'Pro Team': 'DET'},
        {'Name': 'Postponed Guy', 'Pro Team': 'BOS'},
    ])
    games = {
        'DET': GameInfo(opponent='NYK', is_home=True),
        'BOS': GameInfo(opponent='MIA', is_home=False),
    }
    projections = {'Played Guy': _proj(1), 'Sat Guy': _proj(2), 'Postponed Guy': _proj(3)}

    async def _p():
        return pool

    with patch.object(svc, '_pool', side_effect=_p), patch.object(svc, '_today_et', return_value=day):
        assert await svc.record_pregame_snapshot(players, games, projections, {}, day) == 3

        async with pool.acquire() as conn:
            base = await conn.fetchrow('SELECT base_pts, base_min, store_through FROM model_pregame_projections WHERE player_id = 1')
            assert (base['base_pts'], base['base_min'], base['store_through']) == (20.0, 30.0, prior)

            # Night ingested: DET beat NYK by 12; player 1 played, player 2 has no row.
            await _player_game(conn, 1, 'g1', day, 8, 22.0, pts=11.0, fgm=4.0, fga=12.0, pf=5.0)
            await _team_game(conn, 8, 'g1', day, 110)
            await _team_game(conn, 18, 'g1', day, 98)
            await conn.execute("INSERT INTO model_nightly_runs (game_date, status) VALUES ($1, 'processed')", day)

        assert await svc.reconcile_pending() == 3
        assert await svc.reconcile_pending() == 0  # idempotent

        async with pool.acquire() as conn:
            rows = {r['player_id']: r for r in await conn.fetch('SELECT * FROM model_pregame_projections')}
    assert rows[1]['outcome'] == 'played'
    assert (rows[1]['actual_min'], rows[1]['actual_pts'], rows[1]['actual_pf'], rows[1]['team_margin']) == (22.0, 11.0, 5.0, 12.0)
    assert rows[2]['outcome'] == 'dnp' and rows[2]['actual_min'] == 0 and rows[2]['team_margin'] == 12.0
    assert rows[3]['outcome'] == 'no_game' and rows[3]['game_id'] is None


async def test_newer_store_replaces_unreconciled_snapshot_only(pool):
    day = date(2026, 12, 8)
    players = pd.DataFrame([{'Name': 'Played Guy', 'Pro Team': 'DET'}])
    games = {'DET': GameInfo(opponent='NYK', is_home=True)}

    async def _p():
        return pool

    with patch.object(svc, '_pool', side_effect=_p), patch.object(svc, '_today_et', return_value=day):
        async with pool.acquire() as conn:
            await _team_game(conn, 8, 'g0', day - timedelta(days=3), 100)
        assert await svc.record_pregame_snapshot(players, games, {'Played Guy': _proj(1, pts=20.0)}, {}, day) == 1

        # Same store state again (a different process): first write wins.
        svc._recorded.clear()
        await svc.record_pregame_snapshot(players, games, {'Played Guy': _proj(1, pts=99.0)}, {}, day)
        async with pool.acquire() as conn:
            assert await conn.fetchval('SELECT pred_pts FROM model_pregame_projections') == 20.0
            # The morning run ingests a newer night before tip-off.
            await _team_game(conn, 8, 'g00', day - timedelta(days=1), 100)

        await svc.record_pregame_snapshot(players, games, {'Played Guy': _proj(1, pts=23.0)}, {}, day)
        async with pool.acquire() as conn:
            assert await conn.fetchval('SELECT pred_pts FROM model_pregame_projections') == 23.0
