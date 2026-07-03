"""Orchestration tests for ModelNightlyService (fake DB + fake fetch, no network)."""

from datetime import date

import pandas as pd
import pytest

from app.services import model_nightly_service as mns
from app.services.model_nightly_service import (
    _EVAL_STATS,
    _FS_PLAYER_COLS,
    _FS_TEAM_COLS,
    ModelNightlyService,
    _eval_to_tuple,
)
from model_stats_inference.serving.nightly import NightFetch
from model_stats_inference.serving.simulation import EvalRow

GAME_DATE = date(2026, 1, 15)


class FakeDB:
    def __init__(self):
        self.run = None
        self.has_date = False
        self.player_recs = [{"player_id": 1}]
        self.team_recs = [{"team_id": 10}]
        self.eval_insert_ok = True
        self.fs_insert_ok = True
        self.marked = []          # (game_date, status, num_games, num_rows)
        self.eval_rows = None
        self.fs_rows = None

    async def get_model_nightly_run(self, d):
        return self.run

    async def fs_has_date(self, d):
        return self.has_date

    async def get_fs_rows_before(self, d):
        return self.player_recs, self.team_recs

    async def insert_model_eval_rows(self, rows):
        self.eval_rows = rows
        return self.eval_insert_ok

    async def insert_fs_rows(self, player_rows, team_rows):
        self.fs_rows = (player_rows, team_rows)
        return self.fs_insert_ok

    async def upsert_model_nightly_run(self, d, status, num_games, num_rows):
        self.marked.append((d, status, num_games, num_rows))
        return True


def _night(expected_games=2, complete=True):
    team_games = pd.DataFrame([{
        "TEAM_ID": 10, "GAME_ID": "0021409900", "SEASON": "2025-26",
        "GAME_DATE": pd.Timestamp(GAME_DATE), "TEAM_NAME": "T", "MATCHUP": "A vs. B",
        "PTS": 110.0, "REB": 44.0, "AST": 25.0, "STL": 7.0, "BLK": 5.0,
        "FG3M": 12.0, "FG_PCT": 0.47, "FGA": 88.0, "FTA": 20.0, "TOV": 14.0,
    }])
    return NightFetch(GAME_DATE, pd.DataFrame(), team_games, expected_games, complete)


def _eval_row(eligible=True):
    return EvalRow(
        player_id=1, player_name="P", team_id=10, opponent_team_id=20,
        is_home=True, real_minutes=31.5, eligible=eligible,
        reason="" if eligible else "insufficient history", game_id="0021409900",
        predicted={s: 5.0 for s in _EVAL_STATS} if eligible else {},
        actual={s: 6.0 for s in _EVAL_STATS},
    )


def _night_players_frame():
    return pd.DataFrame([{c: ("0021409900" if c == "GAME_ID" else
                              "2025-26" if c == "SEASON" else
                              pd.Timestamp(GAME_DATE) if c == "GAME_DATE" else
                              "x" if c in ("PLAYER_NAME", "MATCHUP", "POSITION") else
                              1) for c in _FS_PLAYER_COLS}])


@pytest.fixture
def service(monkeypatch):
    ModelNightlyService._instance = None
    svc = ModelNightlyService()
    svc._db = FakeDB()
    monkeypatch.setattr(
        mns.nightly, "fetch_night", lambda d: pytest.fail("fetch_night should not be called")
    )
    yield svc
    ModelNightlyService._instance = None


def _allow_fetch(monkeypatch, night):
    monkeypatch.setattr(mns.nightly, "fetch_night", lambda d: night)


def _allow_predict(monkeypatch, evals):
    monkeypatch.setattr(
        ModelNightlyService, "_predict_sync",
        staticmethod(lambda p, t, n: (evals, _night_players_frame())),
    )


@pytest.mark.asyncio
async def test_already_processed_skips_fetch(service):
    service._db.run = {"game_date": GAME_DATE, "status": "processed"}
    assert await service.run_for_date(GAME_DATE) == "already_processed"


@pytest.mark.asyncio
async def test_leakage_guard_when_rows_already_ingested(service):
    service._db.has_date = True
    assert await service.run_for_date(GAME_DATE) == "store_already_ingested"
    assert service._db.marked == [(GAME_DATE, "store_already_ingested", 0, 0)]


@pytest.mark.asyncio
async def test_leakage_guard_holds_even_with_force(service):
    service._db.run = {"game_date": GAME_DATE, "status": "processed"}
    service._db.has_date = True
    assert await service.run_for_date(GAME_DATE, force=True) == "store_already_ingested"


@pytest.mark.asyncio
async def test_db_unavailable_aborts(service):
    service._db.has_date = None
    assert await service.run_for_date(GAME_DATE) == "db_unavailable"
    assert service._db.marked == []


@pytest.mark.asyncio
async def test_no_games_is_terminal(service, monkeypatch):
    _allow_fetch(monkeypatch, _night(expected_games=0))
    assert await service.run_for_date(GAME_DATE) == "no_games"
    assert service._db.marked == [(GAME_DATE, "no_games", 0, 0)]


@pytest.mark.asyncio
async def test_incomplete_data_left_unmarked_for_retry(service, monkeypatch):
    _allow_fetch(monkeypatch, _night(complete=False))
    assert await service.run_for_date(GAME_DATE) == "incomplete_data"
    assert service._db.marked == []


@pytest.mark.asyncio
async def test_empty_store_requires_bootstrap(service, monkeypatch):
    _allow_fetch(monkeypatch, _night())
    service._db.player_recs = []
    assert await service.run_for_date(GAME_DATE) == "store_not_bootstrapped"


@pytest.mark.asyncio
async def test_failed_eval_write_does_not_mark_run(service, monkeypatch):
    _allow_fetch(monkeypatch, _night())
    _allow_predict(monkeypatch, [_eval_row()])
    service._db.eval_insert_ok = False
    assert await service.run_for_date(GAME_DATE) == "db_write_failed"
    assert service._db.marked == []
    assert service._db.fs_rows is None  # night must not be ingested either


@pytest.mark.asyncio
async def test_happy_path_processes_and_ingests(service, monkeypatch):
    _allow_fetch(monkeypatch, _night())
    _allow_predict(monkeypatch, [_eval_row(), _eval_row(eligible=False)])
    assert await service.run_for_date(GAME_DATE) == "processed"
    assert service._db.marked == [(GAME_DATE, "processed", 2, 2)]
    assert len(service._db.eval_rows) == 2
    player_rows, team_rows = service._db.fs_rows
    assert len(player_rows) == 1 and len(player_rows[0]) == len(_FS_PLAYER_COLS)
    assert len(team_rows) == 1 and len(team_rows[0]) == len(_FS_TEAM_COLS)


def test_eval_to_tuple_shapes():
    eligible = _eval_to_tuple(_eval_row(), GAME_DATE)
    ineligible = _eval_to_tuple(_eval_row(eligible=False), GAME_DATE)
    assert len(eligible) == 10 + 2 * len(_EVAL_STATS)
    assert eligible[10:20] == tuple(5.0 for _ in _EVAL_STATS)      # pred_*
    assert eligible[20:30] == tuple(6.0 for _ in _EVAL_STATS)      # actual_*
    assert ineligible[10:20] == tuple(None for _ in _EVAL_STATS)   # NULL preds
    assert ineligible[20:30] == tuple(6.0 for _ in _EVAL_STATS)
