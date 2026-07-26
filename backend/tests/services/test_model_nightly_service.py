"""Orchestration tests for ModelNightlyService (fake DB + fake fetch, no network)."""

import json
from datetime import date
from types import SimpleNamespace

import pandas as pd
import pytest

from app.services import model_nightly_service as mns
from app.services.model_nightly_service import (
    _EVAL_STATS,
    _FS_PLAYER_COLS,
    _FS_TEAM_COLS,
    ModelNightlyService,
    _eval_to_tuple,
    _player_vectors_df,
    _serialize_vectors,
    _team_vectors_df,
)
from model_stats_inference.serving.nightly import NightFetch
from model_stats_inference.serving.eval_row import EvalRow

GAME_DATE = date(2026, 1, 15)


class FakeDB:
    def __init__(self):
        self.run = None
        self.has_date = False
        self.player_recs = pd.DataFrame([{"PLAYER_ID": 1}])
        self.team_recs = pd.DataFrame([{"TEAM_ID": 10}])
        self.eval_insert_ok = True
        self.fs_insert_ok = True
        self.vec_insert_ok = True
        self.marked = []          # (game_date, status, num_games, num_rows)
        self.eval_rows = None
        self.fs_rows = None
        self.vectors_written = None
        self.vector_feature_keys = None   # union across the 3 vector tables; None = unknown
        self.keys_after_upsert = None     # what a successful rebuild writes, if set

    async def get_feature_vector_keys(self):
        return self.vector_feature_keys

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

    async def upsert_feature_vectors(self, player_rows, team_allowed_rows, team_own_rows):
        self.vectors_written = (player_rows, team_allowed_rows, team_own_rows)
        if self.vec_insert_ok and self.keys_after_upsert is not None:
            # A real rebuild rewrites the blobs, so the stored keys change with it.
            self.vector_feature_keys = self.keys_after_upsert
        return self.vec_insert_ok

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


_DUMMY_VECTORS = ([("pv",)], [("tav",)], [("tov",)])


@pytest.fixture
def service(monkeypatch):
    ModelNightlyService._instance = None
    svc = ModelNightlyService()
    svc._db = FakeDB()
    monkeypatch.setattr(
        mns.nightly, "fetch_night", lambda d: pytest.fail("fetch_night should not be called")
    )
    # Never build a real store from the fake records in unit tests.
    monkeypatch.setattr(
        ModelNightlyService, "_vectors_from_frames",
        staticmethod(lambda p, t: ([], [], [])),
    )
    yield svc
    ModelNightlyService._instance = None


def _allow_fetch(monkeypatch, night):
    monkeypatch.setattr(mns.nightly, "fetch_night", lambda d: night)


def _allow_predict(monkeypatch, evals):
    monkeypatch.setattr(
        ModelNightlyService, "_process_sync",
        staticmethod(lambda p, t, n: (evals, _night_players_frame(), _DUMMY_VECTORS)),
    )


@pytest.mark.asyncio
async def test_already_processed_skips_fetch(service):
    service._db.run = {"game_date": GAME_DATE, "status": "processed"}
    assert await service.run_for_date(GAME_DATE) == "already_processed"


@pytest.mark.asyncio
async def test_leakage_guard_when_rows_already_ingested_refreshes_vectors(service):
    service._db.has_date = True
    assert await service.run_for_date(GAME_DATE) == "store_already_ingested"
    assert service._db.marked == [(GAME_DATE, "store_already_ingested", 0, 0)]
    assert service._db.vectors_written is not None  # vectors refreshed on recovery


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
    service._db.player_recs = pd.DataFrame()
    assert await service.run_for_date(GAME_DATE) == "store_not_bootstrapped"


@pytest.mark.asyncio
async def test_failed_eval_write_does_not_mark_run(service, monkeypatch):
    _allow_fetch(monkeypatch, _night())
    _allow_predict(monkeypatch, [_eval_row()])
    service._db.eval_insert_ok = False
    assert await service.run_for_date(GAME_DATE) == "db_write_failed"
    assert service._db.marked == []
    assert service._db.fs_rows is None


@pytest.mark.asyncio
async def test_failed_vector_write_does_not_mark_run(service, monkeypatch):
    _allow_fetch(monkeypatch, _night())
    _allow_predict(monkeypatch, [_eval_row()])
    service._db.vec_insert_ok = False
    assert await service.run_for_date(GAME_DATE) == "db_write_failed"
    assert service._db.marked == []  # raw rows written, but run left unmarked to retry


@pytest.mark.asyncio
async def test_happy_path_processes_ingests_and_writes_vectors(service, monkeypatch):
    _allow_fetch(monkeypatch, _night())
    _allow_predict(monkeypatch, [_eval_row(), _eval_row(eligible=False)])
    assert await service.run_for_date(GAME_DATE) == "processed"
    assert service._db.marked == [(GAME_DATE, "processed", 2, 2)]
    assert len(service._db.eval_rows) == 2
    player_rows, team_rows = service._db.fs_rows
    assert len(player_rows[0]) == len(_FS_PLAYER_COLS)
    assert len(team_rows[0]) == len(_FS_TEAM_COLS)
    assert service._db.vectors_written == _DUMMY_VECTORS


@pytest.mark.asyncio
async def test_processing_invalidates_in_memory_store(service, monkeypatch):
    _allow_fetch(monkeypatch, _night())
    _allow_predict(monkeypatch, [_eval_row()])
    service._inference_store = SimpleNamespace()  # pretend a store is cached
    await service.run_for_date(GAME_DATE)
    assert service._inference_store is None  # invalidated so next inference reloads fresh


def test_eval_to_tuple_shapes():
    eligible = _eval_to_tuple(_eval_row(), GAME_DATE)
    ineligible = _eval_to_tuple(_eval_row(eligible=False), GAME_DATE)
    assert len(eligible) == 10 + 2 * len(_EVAL_STATS)
    assert eligible[10:20] == tuple(5.0 for _ in _EVAL_STATS)
    assert eligible[20:30] == tuple(6.0 for _ in _EVAL_STATS)
    assert ineligible[10:20] == tuple(None for _ in _EVAL_STATS)
    assert ineligible[20:30] == tuple(6.0 for _ in _EVAL_STATS)


def test_vector_serialize_roundtrip():
    """Serialize vectors -> (simulate DB read) -> reconstruct; values, NaN, and the
    eligible flag must survive intact."""
    pv = pd.DataFrame({
        "PLAYER_ID": [1, 2], "PLAYER_NAME": ["A", "B"], "TEAM_ID": [10, 20],
        "POSITION": ["G", "F"],
        "last_game_date": [pd.Timestamp("2026-01-01"), pd.Timestamp("2026-01-02")],
        "games_count": [15, 5],
        "PTS_global_mean": [20.0, float("nan")], "REB_w5_mean": [5.0, 3.0],
    })
    tav = pd.DataFrame({"TEAM_ID": [10, 20], "OPP_ALLOWED_PTS_global_mean": [110.0, 108.0]})
    tov = pd.DataFrame({"TEAM_ID": [10, 20], "TEAM_PTS_global_mean": [112.0, 109.0]})
    store = SimpleNamespace(player_vectors=pv, team_allowed_vectors=tav, team_own_vectors=tov)

    prows, tarows, torows = _serialize_vectors(store)

    # eligibility computed from games_count vs MIN_INFERENCE_GAMES (10)
    assert prows[0][6] is True and prows[1][6] is False

    # simulate what DBService.load_feature_vectors returns (lowercase cols, json str)
    precs = [{"player_id": p[0], "player_name": p[1], "team_id": p[2], "position": p[3],
              "last_game_date": p[4], "games_count": p[5], "eligible": p[6],
              "features": p[7]} for p in prows]
    tacs = [{"team_id": t[0], "features": t[1]} for t in tarows]

    pv2 = _player_vectors_df(precs).set_index("PLAYER_ID")
    assert pv2.loc[1, "PTS_global_mean"] == 20.0
    assert pd.isna(pv2.loc[2, "PTS_global_mean"])      # NaN survived the JSON round-trip
    assert pv2.loc[1, "REB_w5_mean"] == 5.0
    tav2 = _team_vectors_df(tacs).set_index("TEAM_ID")
    assert tav2.loc[10, "OPP_ALLOWED_PTS_global_mean"] == 110.0
    # features JSON is valid and NaN was stored as null
    assert json.loads(prows[1][7])["PTS_global_mean"] is None


# --- missing features: healing the store after a deploy --------------------


def _real_stored_keys() -> tuple[set[str], set[str]]:
    """(union of all three vector tables, player table alone) from a real build.

    Deliberately NOT derived from `_required_stored_features()`: `required` comes
    from feature_sets/*.json and `stored` from actually running the feature engine
    over the synthetic serving fixtures, so the two sides are independent and a
    mismatch is a real mismatch.
    """
    import numpy as np

    from model_stats_inference.research import data as rdata
    from model_stats_inference.serving import conftest as synth
    from model_stats_inference.serving.feature_store import FeatureStore

    players = synth._make_players(np.random.default_rng(0))
    team_logs = synth._make_team_logs(np.random.default_rng(1))
    store = FeatureStore.build(
        players, rdata.build_team_allowed(team_logs), rdata.build_team_own(team_logs)
    )
    prows, tarows, torows = _serialize_vectors(store)
    player = set(json.loads(prows[0][7]))
    team = set(json.loads(tarows[0][1])) | set(json.loads(torows[0][1]))
    return player | team, player


def _auto_heal(monkeypatch, enabled=True):
    """MODEL_FEATURE_HEAL_AUTO defaults to off, so tests that exercise the
    rebuild have to opt in."""
    monkeypatch.setattr(mns.settings, "model_feature_heal_auto", enabled)


def _count_refreshes(monkeypatch) -> list:
    """Record every _refresh_vectors_through call while keeping real behaviour."""
    calls = []
    original = ModelNightlyService._refresh_vectors_through

    async def counting(self, game_date):
        calls.append(game_date)
        return await original(self, game_date)

    monkeypatch.setattr(ModelNightlyService, "_refresh_vectors_through", counting)
    return calls


def test_required_stored_features_excludes_request_time_ones():
    # Anything LiveInference derives per request is never in the store, so counting
    # it as "missing" would rebuild the vectors every single night.
    required = ModelNightlyService._required_stored_features()
    assert required, "feature sets should contribute stored features"
    assert not (required & mns.REQUEST_TIME_FEATURES)
    assert not [f for f in required if f.startswith(mns.REQUEST_TIME_PREFIX)]
    assert "USG_w10_mean" in required   # the feature this change adds


def test_every_required_feature_is_produced_by_some_vector_table():
    """The check must compare against all three tables, not just the player one.

    A model's feature row is composed from the player vector plus the OPP_ALLOWED_*
    and TEAM_* team vectors, so checking `fs_player_vectors` alone reports the team
    features as permanently missing and rebuilds every night forever.
    """
    required = ModelNightlyService._required_stored_features()
    union, player_only = _real_stored_keys()

    assert not (required - union), (
        f"{len(required - union)} required feature(s) are produced by no vector table: "
        f"{sorted(required - union)[:5]}"
    )
    # Guard the regression directly: the player table alone is NOT sufficient.
    assert required - player_only, (
        "expected team features to live outside fs_player_vectors; if this ever "
        "becomes empty the union below is no longer load-bearing"
    )


@pytest.mark.asyncio
async def test_no_rebuild_when_store_matches_the_deployed_models(service, monkeypatch):
    """The realistic case: a store built by the real engine needs no rebuild."""
    service._db.vector_feature_keys, _ = _real_stored_keys()
    _allow_fetch(monkeypatch, _night(expected_games=0))
    calls = _count_refreshes(monkeypatch)

    statuses = await service.run_catchup()
    assert "missing_features" not in statuses
    assert calls == []
    assert service._db.vectors_written is None


@pytest.mark.asyncio
async def test_missing_features_rebuild_vectors_exactly_once(service, monkeypatch):
    """A deploy that adds a feature heals on the next run — and only that run."""
    _auto_heal(monkeypatch)
    union, _ = _real_stored_keys()
    service._db.vector_feature_keys = union - {"USG_w10_mean"}   # store predates the deploy
    service._db.keys_after_upsert = union                        # the rebuild lands
    # Off-season: no games on any catch-up date, so the per-night rebuild never
    # runs. The heal must still happen.
    _allow_fetch(monkeypatch, _night(expected_games=0))
    calls = _count_refreshes(monkeypatch)

    statuses = await service.run_catchup()
    assert statuses["missing_features"] == "vectors_refreshed"
    assert len(calls) == 1
    assert service._db.vectors_written is not None

    # The stored keys now match, so the next morning is a no-op — no second rebuild.
    service._db.vectors_written = None
    statuses = await service.run_catchup()
    assert "missing_features" not in statuses
    assert len(calls) == 1                       # still one — no second rebuild
    assert service._db.vectors_written is None


@pytest.mark.asyncio
async def test_missing_features_that_survive_the_rebuild_escalate(service, monkeypatch):
    """A feature the engine cannot produce must be reported, not retried forever."""
    _auto_heal(monkeypatch)
    union, _ = _real_stored_keys()
    service._db.vector_feature_keys = union - {"USG_w10_mean"}
    # The rebuild "succeeds" but the keys never change (stale feature set / renamed
    # column), which without the post-check would rebuild again every night.
    _allow_fetch(monkeypatch, _night(expected_games=0))
    calls = _count_refreshes(monkeypatch)

    statuses = await service.run_catchup()
    assert statuses["missing_features"] == "vectors_refresh_incomplete"
    assert len(calls) == 1


@pytest.mark.asyncio
async def test_missing_feature_check_skipped_before_bootstrap(service, monkeypatch):
    # No vectors materialized yet -> nothing to heal; bootstrap owns that case.
    service._db.vector_feature_keys = None
    _allow_fetch(monkeypatch, _night(expected_games=0))
    calls = _count_refreshes(monkeypatch)

    statuses = await service.run_catchup()
    assert "missing_features" not in statuses
    assert calls == []


@pytest.mark.asyncio
async def test_failed_rebuild_is_reported(service, monkeypatch):
    _auto_heal(monkeypatch)
    union, _ = _real_stored_keys()
    service._db.vector_feature_keys = union - {"USG_w10_mean"}
    service._db.vec_insert_ok = False           # upsert fails
    _allow_fetch(monkeypatch, _night(expected_games=0))

    statuses = await service.run_catchup()
    assert statuses["missing_features"] == "vectors_refresh_failed"


@pytest.mark.asyncio
async def test_rebuild_without_raw_rows_is_skipped_not_failed(service, monkeypatch):
    """Tri-state: "nothing to write" must not be reported as a write failure."""
    _auto_heal(monkeypatch)
    union, _ = _real_stored_keys()
    service._db.vector_feature_keys = union - {"USG_w10_mean"}
    service._db.player_recs = pd.DataFrame()    # store not bootstrapped
    _allow_fetch(monkeypatch, _night(expected_games=0))

    statuses = await service.run_catchup()
    assert statuses["missing_features"] == "vectors_refresh_skipped"


@pytest.mark.asyncio
async def test_missing_features_reported_not_rebuilt_when_auto_heal_is_off(service, monkeypatch):
    """Default mode: detect and say what to run, but never rebuild.

    The rebuild needs ~380 MB, which a small container cannot spare mid-flight —
    it gets OOM-killed before the upsert lands, so the gap survives and every
    later run tries again. Detection is three queries and stays on.
    """
    union, _ = _real_stored_keys()
    service._db.vector_feature_keys = union - {"USG_w10_mean"}
    _auto_heal(monkeypatch, enabled=False)
    _allow_fetch(monkeypatch, _night(expected_games=0))
    calls = _count_refreshes(monkeypatch)

    statuses = await service.run_catchup()
    assert statuses["missing_features"] == "manual_refresh_required"
    assert calls == []                              # nothing rebuilt
    assert service._db.vectors_written is None      # store untouched
