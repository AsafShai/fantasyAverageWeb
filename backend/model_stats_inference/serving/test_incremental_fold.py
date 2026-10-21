"""The incremental nightly fold-in equals a full rebuild, for the players it touches.

The nightly's incremental path loads the pre-night store from the stored vectors
(no raw rows), attaches only tonight's players' history, and folds the night in.
``build_current_state`` is per player, so the recomputed vectors must match a
one-shot build over the whole history to the digit — this pins that down on the
synthetic dataset (no network, no models).
"""

from __future__ import annotations

import pandas as pd
from pandas.testing import assert_frame_equal

from model_stats_inference.research import data as rdata
from model_stats_inference.serving.feature_store import FeatureStore, _PLAYER_META


def _vector_frames(store: FeatureStore):
    """The three vector frames as the DB round-trip hands them back: plain
    RangeIndex, meta + float features."""
    pv = store.player_vectors.reset_index(drop=True)
    tav = store.team_allowed_vectors.reset_index(drop=True)
    tov = store.team_own_vectors.reset_index(drop=True)
    return pv, tav, tov


def test_incremental_fold_matches_full_rebuild(raw_players, team_logs):
    raw_players = rdata._to_datetime(raw_players)
    team_logs = rdata._to_datetime(team_logs)
    last_date = raw_players["GAME_DATE"].max()
    before_p = raw_players[raw_players["GAME_DATE"] < last_date]
    before_t = team_logs[team_logs["GAME_DATE"] < last_date]
    night_p = raw_players[raw_players["GAME_DATE"] == last_date]
    night_t = team_logs[team_logs["GAME_DATE"] == last_date]
    assert not night_p.empty and night_p["PLAYER_ID"].nunique() < raw_players["PLAYER_ID"].nunique()

    # Reference: one-shot build over everything.
    full = FeatureStore.build(
        raw_players, rdata.build_team_allowed(team_logs), rdata.build_team_own(team_logs)
    )

    # Incremental: pre-night store from "stored" vectors, tonight's players' history only.
    pre = FeatureStore.build(
        before_p, rdata.build_team_allowed(before_t), rdata.build_team_own(before_t)
    )
    pv, tav, tov = _vector_frames(pre)
    inc = FeatureStore.from_vectors(pv, tav, tov)
    tonight_ids = night_p["PLAYER_ID"].unique()
    inc.players = before_p[before_p["PLAYER_ID"].isin(tonight_ids)].reset_index(drop=True)
    inc.team_allowed = rdata.build_team_allowed(before_t)
    inc.team_own = rdata.build_team_own(before_t)
    inc.update_with_nightly_results(night_p, night_t)

    feature_cols = [c for c in full.player_vectors.columns if c not in _PLAYER_META]
    for pid in tonight_ids:
        got = inc.player_vectors.loc[[pid], feature_cols].reset_index(drop=True)
        want = full.player_vectors.loc[[pid], feature_cols].reset_index(drop=True)
        assert_frame_equal(got, want, check_like=True)
        assert int(inc.player_vectors.at[pid, "games_count"]) == int(full.player_vectors.at[pid, "games_count"])
        assert inc.player_vectors.at[pid, "last_game_date"] == full.player_vectors.at[pid, "last_game_date"]

    # Players who did not play keep their stored (pre-night) vector, which the
    # full rebuild also leaves unchanged.
    idle = [p for p in full.player_vectors.index if p not in set(tonight_ids)]
    assert idle
    assert_frame_equal(
        inc.player_vectors.loc[idle, feature_cols].reset_index(drop=True),
        full.player_vectors.loc[idle, feature_cols].reset_index(drop=True),
        check_like=True,
    )

    # Team vectors are rebuilt whole either way.
    for name in ("team_allowed_vectors", "team_own_vectors"):
        got = getattr(inc, name).sort_index().reset_index(drop=True)
        want = getattr(full, name).sort_index().reset_index(drop=True)
        assert_frame_equal(got, want, check_like=True)
