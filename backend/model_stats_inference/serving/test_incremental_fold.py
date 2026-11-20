"""The incremental nightly fold-in equals a full rebuild, for the players it touches.

The nightly's incremental path loads the pre-night store from the stored vectors
(no raw rows), attaches only tonight's players' history, and folds the night in.
``build_current_state`` is per player, so the recomputed vectors must match a
one-shot build over the whole history to the digit — this pins that down on the
synthetic dataset (no network, no models).
"""

from __future__ import annotations

import numpy as np
import polars as pl

from model_stats_inference.serving import featurize
from model_stats_inference.serving.conftest import to_pl
from model_stats_inference.serving.feature_store import FeatureStore, _PLAYER_META


def _rows(frame: pl.DataFrame, key: str, ids, cols):
    sub = frame.filter(pl.col(key).is_in(list(ids))).sort(key)
    return sub.select(cols)


def _assert_same(got: pl.DataFrame, want: pl.DataFrame):
    assert got.columns == want.columns or sorted(got.columns) == sorted(want.columns)
    for c in want.columns:
        a = got[c].to_numpy().astype(float)
        b = want[c].to_numpy().astype(float)
        np.testing.assert_array_equal(a.view(np.int64), b.view(np.int64), err_msg=c)


def test_incremental_fold_matches_full_rebuild(raw_players, team_logs):
    raw_players = to_pl(raw_players)
    team_logs = to_pl(team_logs)
    last_date = raw_players["GAME_DATE"].max()
    before_p = raw_players.filter(pl.col("GAME_DATE") < last_date)
    before_t = team_logs.filter(pl.col("GAME_DATE") < last_date)
    night_p = raw_players.filter(pl.col("GAME_DATE") == last_date)
    night_t = team_logs.filter(pl.col("GAME_DATE") == last_date)
    assert not night_p.is_empty() and night_p["PLAYER_ID"].n_unique() < raw_players["PLAYER_ID"].n_unique()

    # Reference: one-shot build over everything.
    full = FeatureStore.build(
        raw_players, featurize.build_team_allowed(team_logs), featurize.build_team_own(team_logs)
    )

    # Incremental: pre-night store from "stored" vectors, tonight's players' history only.
    pre = FeatureStore.build(
        before_p, featurize.build_team_allowed(before_t), featurize.build_team_own(before_t)
    )
    inc = FeatureStore.from_vectors(pre.player_vectors, pre.team_allowed_vectors, pre.team_own_vectors)
    tonight_ids = night_p["PLAYER_ID"].unique(maintain_order=True).to_list()
    inc.players = before_p.filter(pl.col("PLAYER_ID").is_in(tonight_ids))
    inc.team_allowed = featurize.build_team_allowed(before_t)
    inc.team_own = featurize.build_team_own(before_t)
    inc.update_with_nightly_results(night_p, night_t)

    feature_cols = [c for c in full.player_vectors.columns if c not in _PLAYER_META]
    _assert_same(_rows(inc.player_vectors, "PLAYER_ID", tonight_ids, feature_cols),
                 _rows(full.player_vectors, "PLAYER_ID", tonight_ids, feature_cols))
    meta = ["PLAYER_ID", "games_count", "last_game_date"]
    assert (_rows(inc.player_vectors, "PLAYER_ID", tonight_ids, meta).to_dicts()
            == _rows(full.player_vectors, "PLAYER_ID", tonight_ids, meta).to_dicts())

    # Players who did not play keep their stored (pre-night) vector, which the
    # full rebuild also leaves unchanged.
    idle = [p for p in full.player_vectors["PLAYER_ID"].to_list() if p not in set(tonight_ids)]
    assert idle
    _assert_same(_rows(inc.player_vectors, "PLAYER_ID", idle, feature_cols),
                 _rows(full.player_vectors, "PLAYER_ID", idle, feature_cols))

    # Team vectors are rebuilt whole either way.
    for name in ("team_allowed_vectors", "team_own_vectors"):
        got, want = getattr(inc, name).sort("TEAM_ID"), getattr(full, name).sort("TEAM_ID")
        _assert_same(got.select(want.columns), want)
