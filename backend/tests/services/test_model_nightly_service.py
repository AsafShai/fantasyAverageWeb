"""Orchestration tests for ModelNightlyService (fake DB + fake fetch, no network)."""

import json
from datetime import date, datetime, timedelta
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
        # Incremental path inputs: the vectors' as-of night vs the latest raw night.
        self.vectors_as_of = None         # None = no vectors yet -> full rebuild path
        self.latest_fs_date = GAME_DATE - timedelta(days=1)
        self.vector_rows = ([{"player_id": 1}], [{"team_id": 10}], [{"team_id": 10}])
        self.players_asked = None         # player ids the incremental history load got

    async def get_vectors_as_of(self):
        return self.vectors_as_of

    async def get_latest_fs_date_before(self, d):
        return self.latest_fs_date

    async def get_fs_rows_before_for_players(self, d, player_ids):
        self.players_asked = list(player_ids)
        return self.player_recs, self.team_recs

    async def load_feature_vectors(self, player_ids=None):
        self.vector_ids_asked = player_ids
        return self.vector_rows

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

    async def insert_fs_rows(self, player_rows, team_rows, use_copy=False):
        self.fs_rows = (player_rows, team_rows)
        self.fs_used_copy = use_copy
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
    # The surprise step has its own tests; here it would only hit the fake DB.
    monkeypatch.setattr(mns.settings, "surprise_nightly_enabled", False)
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
    monkeypatch.setattr(
        ModelNightlyService, "_process_sync_incremental",
        staticmethod(lambda *a: pytest.fail("incremental path must not run here")),
    )


def _allow_predict_incremental(monkeypatch, evals, calls):
    def incremental(pv, tav, tov, players, team_games, night):
        calls.append((pv, tav, tov, len(players), len(team_games)))
        return evals, _night_players_frame(), _DUMMY_VECTORS
    monkeypatch.setattr(ModelNightlyService, "_process_sync_incremental", staticmethod(incremental))
    monkeypatch.setattr(
        ModelNightlyService, "_process_sync",
        staticmethod(lambda *a: pytest.fail("full rebuild must not run here")),
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
async def test_empty_scoreboard_incomplete_is_retried_not_sealed(service, monkeypatch):
    """expected_games=0 with complete=False (the whitelist-ambiguity guard in
    nightly.fetch_night) must be retried, not sealed as 'no_games' — the
    incomplete check has to run before the expected_games==0 check."""
    _allow_fetch(monkeypatch, _night(expected_games=0, complete=False))
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
async def test_incremental_path_when_stored_vectors_are_current(service, monkeypatch):
    """Vectors through last night == raw rows through last night: score from the
    stored vectors, load only tonight's players' history, write the night."""
    night = _night()
    night.player_games = _night_players_frame()
    _allow_fetch(monkeypatch, night)
    calls = []
    _allow_predict_incremental(monkeypatch, [_eval_row()], calls)
    service._db.vectors_as_of = service._db.latest_fs_date = GAME_DATE - timedelta(days=1)

    assert await service.run_for_date(GAME_DATE) == "processed"
    assert len(calls) == 1
    assert calls[0][:3] == service._db.vector_rows
    assert service._db.players_asked == [1]
    assert service._db.vector_ids_asked == [1]        # only tonight's players' vectors
    assert service._db.marked == [(GAME_DATE, "processed", 2, 1)]
    assert service._db.vectors_written == _DUMMY_VECTORS


@pytest.mark.asyncio
@pytest.mark.parametrize("as_of_offset", [None, 2])
async def test_full_rebuild_when_vectors_missing_or_stale(service, monkeypatch, as_of_offset):
    """No vectors yet, or vectors older than the raw rows (a crashed run): rebuild
    from the full history, which also heals the vectors."""
    _allow_fetch(monkeypatch, _night())
    _allow_predict(monkeypatch, [_eval_row()])
    service._db.vectors_as_of = (
        None if as_of_offset is None else GAME_DATE - timedelta(days=as_of_offset)
    )
    assert await service.run_for_date(GAME_DATE) == "processed"
    assert service._db.players_asked is None
    assert service._db.marked == [(GAME_DATE, "processed", 2, 1)]


@pytest.mark.asyncio
async def test_incremental_path_without_vector_rows_requires_bootstrap(service, monkeypatch):
    night = _night()
    night.player_games = _night_players_frame()
    _allow_fetch(monkeypatch, night)
    _allow_predict_incremental(monkeypatch, [_eval_row()], [])
    service._db.vectors_as_of = service._db.latest_fs_date = GAME_DATE - timedelta(days=1)
    service._db.vector_rows = ([], [], [])          # no team vectors at all
    assert await service.run_for_date(GAME_DATE) == "store_not_bootstrapped"


def test_serialize_vectors_can_limit_to_given_players():
    pv = pd.DataFrame({
        "PLAYER_ID": [1, 2, 3], "PLAYER_NAME": ["a", "b", "c"], "TEAM_ID": [10, 10, 20],
        "POSITION": ["G", "F", "C"], "last_game_date": [pd.Timestamp(GAME_DATE)] * 3,
        "games_count": [12, 3, 40], "F1": [0.1, 0.2, 0.3],
    })
    teams = pd.DataFrame({"TEAM_ID": [10, 20], "T1": [1.0, 2.0]})
    store = SimpleNamespace(player_vectors=pv, team_allowed_vectors=teams, team_own_vectors=teams)
    all_rows, _, _ = _serialize_vectors(store)
    some_rows, tav, tov = _serialize_vectors(store, player_ids=[3, 1])
    assert [r[0] for r in all_rows] == [1, 2, 3]
    assert [r[0] for r in some_rows] == [1, 3]
    assert len(tav) == len(tov) == 2


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

    # dicts, not JSON strings: the pool's jsonb codec encodes them (a pre-dumped
    # string would be stored as a JSON string scalar)
    assert all(isinstance(p[7], dict) for p in prows)
    assert all(isinstance(t[1], dict) for t in tarows + torows)

    # simulate what DBService.load_feature_vectors returns (lowercase cols, decoded jsonb)
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
    # NaN is serialized as None (null in jsonb)
    assert prows[1][7]["PTS_global_mean"] is None

    # Rows written before the fix were double-encoded: the codec decodes them to
    # a JSON *string*. They must still load until the next run rewrites them.
    legacy = [{**r, "features": json.dumps(r["features"])} for r in precs]
    pv3 = _player_vectors_df(legacy).set_index("PLAYER_ID")
    assert pv3.loc[1, "PTS_global_mean"] == 20.0
    assert pd.isna(pv3.loc[2, "PTS_global_mean"])


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
    player = set(prows[0][7])
    team = set(tarows[0][1]) | set(torows[0][1])
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



def _stub_backfill(monkeypatch, result=None, raises=None):
    """Replace the surprises backfill; returns the list of ``since`` it was called with."""
    from app.services.surprise_service import SurpriseService
    calls = []

    async def backfill(self, since=None):
        calls.append(since)
        if raises:
            raise raises
        return result or {}
    monkeypatch.setattr(SurpriseService, "backfill_missing", backfill)
    return calls


@pytest.mark.asyncio
async def test_catchup_scores_unscored_nights_in_its_window(service, monkeypatch):
    """A run that died after marking a night processed left it unscored; the
    next slot scores it instead of skipping it for good, looking back only as
    far as the catch-up window."""
    service._db.vector_feature_keys, _ = _real_stored_keys()
    service._db.run = {"game_date": GAME_DATE, "status": "processed"}
    monkeypatch.setattr(mns.settings, "surprise_nightly_enabled", True)
    calls = _stub_backfill(monkeypatch, {GAME_DATE: "processed"})

    statuses = await service.run_catchup()
    yesterday = (datetime.now(mns.ISRAEL_TZ) - timedelta(days=1)).date()
    assert calls == [yesterday - timedelta(days=mns.CATCHUP_DAYS - 1)]
    assert statuses["surprises_retry"] == f"{GAME_DATE}: processed"


@pytest.mark.asyncio
async def test_catchup_retry_failure_does_not_stop_the_catchup(service, monkeypatch):
    service._db.vector_feature_keys, _ = _real_stored_keys()
    service._db.run = {"game_date": GAME_DATE, "status": "processed"}
    monkeypatch.setattr(mns.settings, "surprise_nightly_enabled", True)
    _stub_backfill(monkeypatch, raises=RuntimeError("db down"))

    statuses = await service.run_catchup()
    assert statuses["surprises_retry"] == "failed"


@pytest.mark.asyncio
async def test_catchup_retry_runs_when_the_catchup_stops_on_incomplete_data(service, monkeypatch):
    service._db.vector_feature_keys, _ = _real_stored_keys()
    _allow_fetch(monkeypatch, _night(complete=False))
    monkeypatch.setattr(mns.settings, "surprise_nightly_enabled", True)
    calls = _stub_backfill(monkeypatch)

    statuses = await service.run_catchup()
    assert "incomplete_data" in statuses.values()
    assert len(calls) == 1
    assert "surprises_retry" not in statuses     # nothing was missing


@pytest.mark.asyncio
async def test_catchup_retry_off_with_the_surprises_switch(service, monkeypatch):
    service._db.vector_feature_keys, _ = _real_stored_keys()
    service._db.run = {"game_date": GAME_DATE, "status": "processed"}
    calls = _stub_backfill(monkeypatch)       # the fixture turned surprises off

    await service.run_catchup()
    assert calls == []


# --- the scheduler's night, roster stints, read caches -------------------------

def _ledger(service, by_date):
    """Ledger rows per date (others absent)."""
    async def get_run(d):
        return by_date.get(d)
    service._db.get_model_nightly_run = get_run


async def _no_sweep(self, newest):
    return None


def _stints_rebuild(monkeypatch):
    from unittest.mock import AsyncMock
    from app.services.roster_stints.service import RosterStintsService
    rebuild = AsyncMock()
    monkeypatch.setattr(RosterStintsService, "rebuild", rebuild)
    return rebuild


@pytest.mark.asyncio
async def test_catchup_runs_through_the_night_it_is_given(service, monkeypatch):
    """The scheduler passes the night's US date: an afternoon-only slate is
    processed while it is still the same day in Israel."""
    service._db.vector_feature_keys, _ = _real_stored_keys()
    night = date(2026, 11, 19)
    seen = []
    monkeypatch.setattr(mns.nightly, "fetch_night", lambda d: seen.append(d) or _night(expected_games=0))
    statuses = await service.run_catchup(through=night)
    window = [night - timedelta(days=o) for o in range(mns.CATCHUP_DAYS - 1, -1, -1)]
    assert seen == window
    assert [k for k in statuses if k[:4].isdigit()] == [d.isoformat() for d in window]


@pytest.mark.asyncio
async def test_catchup_without_a_night_keeps_yesterday_in_israel(service, monkeypatch):
    service._db.vector_feature_keys, _ = _real_stored_keys()
    service._db.run = {"status": "processed"}
    statuses = await service.run_catchup()
    yesterday = (datetime.now(mns.ISRAEL_TZ) - timedelta(days=1)).date()
    assert max(k for k in statuses if k[:4].isdigit()) == yesterday.isoformat()


@pytest.mark.asyncio
async def test_stints_are_not_rebuilt_on_a_retry_that_recorded_nothing(service, monkeypatch):
    service._db.vector_feature_keys, _ = _real_stored_keys()
    service._db.run = {"status": "processed"}            # every night already in the ledger
    rebuild = _stints_rebuild(monkeypatch)
    await service.run_catchup(through=GAME_DATE)
    rebuild.assert_not_awaited()


@pytest.mark.asyncio
async def test_stints_are_not_rebuilt_while_the_night_is_incomplete(service, monkeypatch):
    service._db.vector_feature_keys, _ = _real_stored_keys()
    _ledger(service, {GAME_DATE - timedelta(days=o): {"status": "processed"} for o in range(1, 7)})
    _allow_fetch(monkeypatch, _night(complete=False))
    rebuild = _stints_rebuild(monkeypatch)
    statuses = await service.run_catchup(through=GAME_DATE)
    assert statuses[GAME_DATE.isoformat()] == "incomplete_data"
    rebuild.assert_not_awaited()


@pytest.mark.asyncio
async def test_stints_are_rebuilt_when_a_night_lands(service, monkeypatch):
    """Off nights too: transactions happen on days without games."""
    service._db.vector_feature_keys, _ = _real_stored_keys()
    _ledger(service, {GAME_DATE - timedelta(days=o): {"status": "processed"} for o in range(1, 7)})
    _allow_fetch(monkeypatch, _night(expected_games=0))
    rebuild = _stints_rebuild(monkeypatch)
    statuses = await service.run_catchup(through=GAME_DATE)
    assert statuses[GAME_DATE.isoformat()] == "no_games"
    rebuild.assert_awaited_once()


@pytest.mark.asyncio
async def test_stints_are_rebuilt_on_the_final_attempt_even_with_nothing_new(service, monkeypatch):
    service._db.vector_feature_keys, _ = _real_stored_keys()
    service._db.run = {"status": "processed"}
    rebuild = _stints_rebuild(monkeypatch)
    monkeypatch.setattr(ModelNightlyService, "sweep_corrections", _no_sweep)
    await service.run_catchup(through=GAME_DATE, final=True)
    rebuild.assert_awaited_once()


@pytest.mark.asyncio
async def test_waiting_on_games_is_logged_as_info_a_failure_as_a_warning(service, monkeypatch, caplog):
    import logging
    service._db.vector_feature_keys, _ = _real_stored_keys()
    _allow_fetch(monkeypatch, _night(complete=False))
    with caplog.at_level(logging.INFO, logger=mns.logger.name):
        await service.run_catchup(through=GAME_DATE)
    stopped = [r for r in caplog.records if "catch-up stopped" in r.getMessage()]
    assert stopped and all(r.levelno == logging.INFO for r in stopped)

    caplog.clear()
    service._db.has_date = None                          # db_unavailable
    with caplog.at_level(logging.INFO, logger=mns.logger.name):
        await service.run_catchup(through=GAME_DATE)
    stopped = [r for r in caplog.records if "catch-up stopped" in r.getMessage()]
    assert stopped and all(r.levelno == logging.WARNING for r in stopped)


@pytest.mark.asyncio
async def test_recording_a_night_clears_the_latest_night_read_caches(monkeypatch):
    from app.services import player_service, today_service
    calls = []
    monkeypatch.setattr(player_service, "clear_night_caches", lambda: calls.append("players"))
    monkeypatch.setattr(today_service, "clear_today_hub_cache", lambda: calls.append("hub"))
    db = FakeDB()
    await ModelNightlyService._record_run(db, GAME_DATE, "processed", 4, 89)
    assert sorted(calls) == ["hub", "players"]


@pytest.mark.asyncio
async def test_a_failing_cache_clear_never_fails_the_run(monkeypatch):
    from app.services import player_service, today_service

    def boom():
        raise RuntimeError("cache")
    hub = []
    monkeypatch.setattr(player_service, "clear_night_caches", boom)
    monkeypatch.setattr(today_service, "clear_today_hub_cache", lambda: hub.append(1))
    assert await ModelNightlyService._record_run(FakeDB(), GAME_DATE, "processed", 4, 89) is not False
    assert hub == [1]                                    # the other cache is still cleared


# --- ESPN's later corrections (sweep_corrections) -------------------------------

SWEEP_NIGHT = GAME_DATE


def _fs_player(pid, reb=5.0, position="G", gid="0021409900", **extra):
    row = {c: 1.0 for c in _FS_PLAYER_COLS}
    row.update({"PLAYER_ID": pid, "GAME_ID": gid, "SEASON": "2025-26", "GAME_DATE": pd.Timestamp(SWEEP_NIGHT),
                "PLAYER_NAME": f"P{pid}", "TEAM_ID": 10, "MATCHUP": "A vs. B", "POSITION": position,
                "MIN": 30.0, "REB": reb, "DREB": reb})
    row.update(extra)
    return row


def _fs_team(tid, reb=44.0):
    return {"TEAM_ID": tid, "GAME_ID": "0021409900", "SEASON": "2025-26", "GAME_DATE": pd.Timestamp(SWEEP_NIGHT),
            "TEAM_NAME": "T", "MATCHUP": "A vs. B", "PTS": 110.0, "REB": reb, "AST": 25.0, "STL": 7.0,
            "BLK": 5.0, "FG3M": 12.0, "FG_PCT": 0.47, "FGA": 88.0, "FTA": 20.0, "TOV": 14.0}


class SweepDB(FakeDB):
    def __init__(self, stored_players, stored_teams, processed=(SWEEP_NIGHT,)):
        super().__init__()
        self.stored = (pd.DataFrame(stored_players), pd.DataFrame(stored_teams))
        self.processed = set(processed)
        self.applied, self.actuals = [], []
        self.apply_ok = True
        self.vectors_as_of = self.latest_fs_date = SWEEP_NIGHT

    async def get_model_nightly_run(self, d):
        return {"status": "processed"} if d in self.processed else None

    async def get_fs_rows_on(self, d):
        return self.stored

    async def apply_fs_corrections(self, player_rows, team_rows):
        self.applied.append((player_rows, team_rows))
        return self.apply_ok

    async def update_model_eval_actuals(self, rows):
        self.actuals.extend(rows)
        return True


def _espn_night(players, teams, complete=True):
    return NightFetch(SWEEP_NIGHT, pd.DataFrame(players), pd.DataFrame(teams), 1, complete)


@pytest.fixture
def sweep(service, monkeypatch):
    """The service with the recompute and the Boom or Bust rescore recorded."""
    calls = {"recompute": [], "rescore": []}

    def recompute(pv, tav, tov, players, team_games, player_ids, team_ids):
        calls["recompute"].append((sorted(player_ids), sorted(team_ids)))
        return ([("p",)], [("ta",)], [("to",)])
    monkeypatch.setattr(ModelNightlyService, "_recompute_sync", staticmethod(recompute))

    from app.services.surprise_service import SurpriseService

    async def rescore(self, d, require_roster=False):
        calls["rescore"].append((d, require_roster))
        return "processed"
    monkeypatch.setattr(SurpriseService, "compute_and_store", rescore)
    monkeypatch.setattr(mns.settings, "surprise_nightly_enabled", True)
    cleared = []
    monkeypatch.setattr(mns, "_clear_night_read_caches", lambda: cleared.append(1))
    calls["cleared"] = cleared
    return service, calls


@pytest.mark.asyncio
async def test_sweep_applies_a_corrected_rebound_everywhere_it_lands(sweep, monkeypatch):
    service, calls = sweep
    service._db = SweepDB([_fs_player(1, reb=6), _fs_player(2, reb=6)], [_fs_team(10), _fs_team(20)])
    _allow_fetch(monkeypatch, _espn_night([_fs_player(1, reb=5, position=""), _fs_player(2, reb=6)],
                                         [_fs_team(10), _fs_team(20)]))
    result = await service.sweep_corrections(SWEEP_NIGHT)

    (players, teams), = service._db.applied
    assert [r[0] for r in players] == [1] and teams == []
    assert players[0][_FS_PLAYER_COLS.index("REB")] == 5.0
    (actual,) = service._db.actuals                       # predictions untouched, actuals updated
    assert actual[:2] == ("0021409900", 1) and actual[2 + mns._EVAL_STATS.index("REB")] == 5.0
    assert calls["recompute"] == [([1], [10, 20])]
    assert service._db.vectors_written == ([("p",)], [("ta",)], [("to",)])
    assert calls["rescore"] == [(SWEEP_NIGHT, True)]      # owners kept: rescore requires the rosters
    assert calls["cleared"]
    assert "1 changed" in result and "vectors: refreshed" in result


@pytest.mark.asyncio
async def test_sweep_with_nothing_changed_writes_nothing(sweep, monkeypatch):
    service, calls = sweep
    rows, teams = [_fs_player(1)], [_fs_team(10), _fs_team(20)]
    service._db = SweepDB(rows, teams)
    _allow_fetch(monkeypatch, _espn_night(rows, teams))
    assert await service.sweep_corrections(SWEEP_NIGHT) is None
    assert service._db.applied == [] and calls["recompute"] == [] and calls["rescore"] == []
    assert service._db.vectors_written is None and not calls["cleared"]


@pytest.mark.asyncio
async def test_sweep_reads_only_processed_nights_in_the_window(sweep, monkeypatch):
    service, _ = sweep
    window = [SWEEP_NIGHT - timedelta(days=o) for o in range(mns.CATCHUP_DAYS)]
    service._db = SweepDB([_fs_player(1)], [_fs_team(10)], processed=window[::2] + [SWEEP_NIGHT - timedelta(days=9)])
    fetched = []
    monkeypatch.setattr(mns.nightly, "fetch_night",
                        lambda d: fetched.append(d) or _espn_night([_fs_player(1)], [_fs_team(10)]))
    await service.sweep_corrections(SWEEP_NIGHT)
    assert sorted(fetched) == sorted(window[::2])          # never older than the window, never unprocessed


@pytest.mark.asyncio
async def test_sweep_leaves_a_night_espn_no_longer_serves_complete(sweep, monkeypatch):
    service, calls = sweep
    service._db = SweepDB([_fs_player(1, reb=6)], [_fs_team(10)])
    _allow_fetch(monkeypatch, _espn_night([_fs_player(1, reb=5)], [_fs_team(10)], complete=False))
    assert await service.sweep_corrections(SWEEP_NIGHT) is None
    assert service._db.applied == []


@pytest.mark.asyncio
async def test_sweep_never_deletes_a_line_espn_dropped(sweep, monkeypatch):
    service, calls = sweep
    service._db = SweepDB([_fs_player(1), _fs_player(2)], [_fs_team(10)])
    _allow_fetch(monkeypatch, _espn_night([_fs_player(1)], [_fs_team(10)]))
    assert await service.sweep_corrections(SWEEP_NIGHT) is None
    assert service._db.applied == []


@pytest.mark.asyncio
async def test_sweep_new_line_takes_the_players_stored_position_when_espns_is_empty(sweep, monkeypatch):
    service, _ = sweep
    service._db = SweepDB([_fs_player(1, position="C", gid="0021409899")], [_fs_team(10)])
    _allow_fetch(monkeypatch, _espn_night([_fs_player(1, position="", gid="0021409899"),
                                           _fs_player(1, position="", gid="0021409900")], [_fs_team(10)]))
    await service.sweep_corrections(SWEEP_NIGHT)
    (players, _), = service._db.applied
    assert [(r[1], r[_FS_PLAYER_COLS.index("POSITION")]) for r in players] == [("0021409900", "C")]


@pytest.mark.asyncio
async def test_sweep_team_only_correction_recomputes_teams(sweep, monkeypatch):
    service, calls = sweep
    service._db = SweepDB([_fs_player(1)], [_fs_team(10, reb=44), _fs_team(20)])
    _allow_fetch(monkeypatch, _espn_night([_fs_player(1)], [_fs_team(10, reb=45), _fs_team(20)]))
    await service.sweep_corrections(SWEEP_NIGHT)
    (_, teams), = service._db.applied
    assert [t[0] for t in teams] == [10]
    assert calls["recompute"] == [([], [10, 20])]


@pytest.mark.asyncio
async def test_sweep_failed_write_touches_nothing_else(sweep, monkeypatch):
    service, calls = sweep
    service._db = SweepDB([_fs_player(1, reb=6)], [_fs_team(10)])
    service._db.apply_ok = False
    _allow_fetch(monkeypatch, _espn_night([_fs_player(1, reb=5)], [_fs_team(10)]))
    result = await service.sweep_corrections(SWEEP_NIGHT)
    assert "write failed" in result
    assert service._db.actuals == [] and calls["recompute"] == [] and calls["rescore"] == []


@pytest.mark.asyncio
async def test_sweep_leaves_stale_vectors_to_the_full_rebuild(sweep, monkeypatch):
    service, calls = sweep
    service._db = SweepDB([_fs_player(1, reb=6)], [_fs_team(10)])
    service._db.vectors_as_of = SWEEP_NIGHT - timedelta(days=1)
    _allow_fetch(monkeypatch, _espn_night([_fs_player(1, reb=5)], [_fs_team(10)]))
    result = await service.sweep_corrections(SWEEP_NIGHT)
    assert "left_to_rebuild" in result
    assert calls["recompute"] == [] and service._db.vectors_written is None
    assert len(service._db.applied) == 1 and calls["rescore"]      # rows still corrected


@pytest.mark.asyncio
async def test_sweep_db_unavailable_and_errors_never_raise(sweep, monkeypatch):
    service, _ = sweep
    service._db = SweepDB([_fs_player(1)], [_fs_team(10)])

    async def down(d):
        return None, None
    service._db.get_fs_rows_on = down
    _allow_fetch(monkeypatch, _espn_night([_fs_player(1)], [_fs_team(10)]))
    assert await service.sweep_corrections(SWEEP_NIGHT) == "db_unavailable"

    def boom(d):
        raise RuntimeError("espn down")
    monkeypatch.setattr(mns.nightly, "fetch_night", boom)
    assert await service.sweep_corrections(SWEEP_NIGHT) == "failed"


@pytest.mark.asyncio
async def test_catchup_sweeps_on_the_final_attempt_only(service, monkeypatch):
    service._db.vector_feature_keys, _ = _real_stored_keys()
    service._db.run = {"status": "processed"}
    swept = []

    async def fake_sweep(self, newest):
        swept.append(newest)
        return "2026-01-15: 1 changed; vectors: refreshed"
    monkeypatch.setattr(ModelNightlyService, "sweep_corrections", fake_sweep)
    prewarmed = []

    async def prewarm(self):
        prewarmed.append(1)
    monkeypatch.setattr(ModelNightlyService, "_prewarm_inference_store", prewarm)

    statuses = await service.run_catchup(through=GAME_DATE)
    assert swept == [] and "corrections" not in statuses
    statuses = await service.run_catchup(through=GAME_DATE, final=True)
    assert swept == [GAME_DATE]
    assert statuses["corrections"].endswith("vectors: refreshed")
    assert prewarmed == [1]                                # fresh vectors reach the resident store


@pytest.mark.asyncio
async def test_catchup_survives_a_failing_sweep(service, monkeypatch):
    service._db.vector_feature_keys, _ = _real_stored_keys()
    service._db.run = {"status": "processed"}
    rebuild = _stints_rebuild(monkeypatch)
    monkeypatch.setattr(mns.nightly, "fetch_night", lambda d: (_ for _ in ()).throw(RuntimeError("down")))
    statuses = await service.run_catchup(through=GAME_DATE, final=True)
    assert statuses["corrections"] == "failed"
    rebuild.assert_awaited_once()                          # the rest of the morning still ran


def _records(serialized):
    """_serialize_vectors tuples -> the dict rows load_feature_vectors returns."""
    prows, tarows, torows = serialized
    pv = [dict(player_id=r[0], player_name=r[1], team_id=r[2], position=r[3], last_game_date=r[4],
               games_count=r[5], features=r[7]) for r in prows]
    return pv, [dict(team_id=t, features=f) for t, f in tarows], [dict(team_id=t, features=f) for t, f in torows]


def test_recompute_after_a_correction_equals_a_full_rebuild():
    """The sweep's light recompute (one player's corrected history, every team)
    must produce exactly what the full rebuild from the corrected rows does."""
    import numpy as np
    from model_stats_inference.research import data as rdata
    from model_stats_inference.serving import conftest as synth
    from model_stats_inference.serving.feature_store import FeatureStore

    players = synth._make_players(np.random.default_rng(0))
    teams = synth._make_team_logs(np.random.default_rng(1))
    before = FeatureStore.build(players, rdata.build_team_allowed(teams), rdata.build_team_own(teams))
    stored = _records(_serialize_vectors(before))

    pid = int(players["PLAYER_ID"].iloc[0])
    corrected = players.copy()
    hit = corrected.index[corrected["PLAYER_ID"] == pid][-1]
    corrected.loc[hit, ["REB", "DREB"]] += 1
    corrected_teams = teams.copy()
    t_hit = corrected_teams.index[(corrected_teams["GAME_ID"] == corrected.loc[hit, "GAME_ID"])][0]
    corrected_teams.loc[t_hit, "REB"] += 1
    team_ids = sorted(int(t) for t in corrected_teams["TEAM_ID"].unique())

    full = FeatureStore.build(corrected, rdata.build_team_allowed(corrected_teams), rdata.build_team_own(corrected_teams))
    expected = _serialize_vectors(full, player_ids=[pid])

    mine = corrected[corrected["PLAYER_ID"] == pid]
    got = ModelNightlyService._recompute_sync(*stored, mine, corrected_teams, [pid], team_ids)

    def by_id(rows):
        return {r[0]: r for r in rows}
    (exp_p,), (got_p,) = expected[0], got[0]
    assert got_p[:7] == exp_p[:7]
    assert got_p[7] == pytest.approx(exp_p[7], nan_ok=True)
    assert got_p[7] != stored[0][[r["player_id"] for r in stored[0]].index(pid)]["features"]   # it moved
    for g, e in ((got[1], expected[1]), (got[2], expected[2])):
        assert by_id(g).keys() == by_id(e).keys()
        for tid in by_id(e):
            assert by_id(g)[tid][1] == pytest.approx(by_id(e)[tid][1], nan_ok=True)


def test_recompute_with_only_team_corrections_equals_a_full_rebuild():
    import numpy as np
    from model_stats_inference.research import data as rdata
    from model_stats_inference.serving import conftest as synth
    from model_stats_inference.serving.feature_store import FeatureStore

    players = synth._make_players(np.random.default_rng(0))
    teams = synth._make_team_logs(np.random.default_rng(1))
    before = FeatureStore.build(players, rdata.build_team_allowed(teams), rdata.build_team_own(teams))
    stored = _records(_serialize_vectors(before))
    corrected_teams = teams.copy()
    corrected_teams.loc[corrected_teams.index[-1], "TOV"] += 2
    team_ids = sorted(int(t) for t in corrected_teams["TEAM_ID"].unique())
    full = FeatureStore.build(players, rdata.build_team_allowed(corrected_teams), rdata.build_team_own(corrected_teams))
    expected = _serialize_vectors(full, player_ids=[])

    got = ModelNightlyService._recompute_sync(*stored, players.iloc[0:0], corrected_teams, [], team_ids)
    assert got[0] == []                                      # no player rewritten
    for g, e in ((got[1], expected[1]), (got[2], expected[2])):
        assert {t: f for t, f in g}.keys() == {t: f for t, f in e}.keys()
        for (tg, fg), (te, fe) in zip(sorted(g, key=lambda r: r[0]), sorted(e, key=lambda r: r[0])):
            assert fg == pytest.approx(fe, nan_ok=True)
