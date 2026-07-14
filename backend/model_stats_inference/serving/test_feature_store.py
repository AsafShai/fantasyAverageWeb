"""FeatureStore tests: build, reads, errors, nightly update, persistence.

Run: uv run pytest model_stats_inference/serving/test_feature_store.py
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from model_stats_inference.research import data as rdata
from model_stats_inference.serving.errors import (
    InsufficientHistoryError,
    UnknownPlayerError,
    UnknownTeamError,
)
from model_stats_inference.serving.feature_store import FeatureStore
from model_stats_inference.serving.conftest import FULL_PID, LOW_PID, TEAM_A, TEAM_B


def test_full_player_has_state(store):
    state = store.get_player_state(FULL_PID)
    assert state.games_count == 25
    assert state.team_id == TEAM_A
    assert state.position == "G"
    assert np.isfinite(state.vector["PTS_global_mean"])


def test_global_mean_includes_last_game(store, raw_players):
    # as-of vector is the mean over ALL of the player's games (incl. the last one).
    expected = raw_players.loc[raw_players["PLAYER_ID"] == FULL_PID, "PTS"].mean()
    got = store.get_player_state(FULL_PID).vector["PTS_global_mean"]
    assert got == pytest.approx(expected, rel=1e-6)


def test_player_vector_has_ewm_block_features(store, raw_players):
    # As-of EWM state includes the player's last game (unshifted path).
    vec = store.get_player_state(FULL_PID).vector
    blk = raw_players.loc[raw_players["PLAYER_ID"] == FULL_PID].sort_values("GAME_DATE")["BLK"]
    expected = blk.ewm(halflife=5, min_periods=1).mean().iloc[-1]
    assert vec["BLK_ewm5_mean"] == pytest.approx(expected, rel=1e-6)
    for col in ("BLK_ewm15_rate", "BLK_share_ewm10", "BLK_share_global"):
        assert np.isfinite(vec[col])


def test_player_vector_has_bio_columns(store):
    # Synthetic player ids aren't in the committed bio artifact -> columns exist, NaN.
    vec = store.get_player_state(FULL_PID).vector
    for col in ("HEIGHT_IN", "WEIGHT_LB", "WINGSPAN_IN", "REACH_IN", "WING_MINUS_HEIGHT"):
        assert col in vec.index


def test_unknown_player_raises(store):
    with pytest.raises(UnknownPlayerError):
        store.get_player_state(99999)


def test_low_history_player_raises(store):
    with pytest.raises(InsufficientHistoryError) as exc:
        store.get_player_state(LOW_PID)        # only 5 games < MIN_INFERENCE_GAMES(10)
    assert exc.value.games == 5
    assert exc.value.required == 10


def test_unknown_team_raises(store):
    with pytest.raises(UnknownTeamError):
        store.get_team_state(77777)


def test_team_state_has_both_views(store):
    ts = store.get_team_state(TEAM_B)
    assert any(c.startswith("OPP_ALLOWED_") for c in ts.allowed.index)
    assert any(c.startswith("TEAM_") and c != "TEAM_ID" for c in ts.own.index)


def test_nightly_update_appends_and_recomputes(store, raw_players, team_logs):
    before = store.get_player_state(FULL_PID)
    n_before = before.games_count
    pts_mean_before = before.vector["PTS_global_mean"]

    # One new game for FULL_PID (a 40-point night) + the matching team rows.
    dates = raw_players["GAME_DATE"].max() + pd.Timedelta(days=2)
    new_pg = raw_players[raw_players["PLAYER_ID"] == FULL_PID].iloc[[-1]].copy()
    new_pg["GAME_ID"] = "0021409999"
    new_pg["GAME_DATE"] = dates
    new_pg["PTS"] = 40
    new_tg = team_logs[team_logs["GAME_ID"] == team_logs["GAME_ID"].iloc[0]].copy()
    new_tg["GAME_ID"] = "0021409999"
    new_tg["GAME_DATE"] = dates

    store.update_with_nightly_results(new_pg, new_tg)

    after = store.get_player_state(FULL_PID)
    assert after.games_count == n_before + 1
    assert after.vector["PTS_global_mean"] != pts_mean_before  # recomputed


def test_save_load_roundtrip(store, tmp_path):
    store.save(tmp_path)
    loaded = FeatureStore.load(tmp_path)
    assert loaded.get_player_state(FULL_PID).games_count == 25
    with pytest.raises(InsufficientHistoryError):
        loaded.get_player_state(LOW_PID)
