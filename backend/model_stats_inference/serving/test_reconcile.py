"""Tests for the MinT reconciler — both the math (apply) and the live integration."""

from __future__ import annotations

import numpy as np

from model_stats_inference.serving.inference import LiveInference, PredictionRequest
from model_stats_inference.serving.reconcile import Reconciler
from model_stats_inference.training.reconcile import SHOOTING_TARGETS

TARGETS = SHOOTING_TARGETS  # [PTS, FGM, FG3M, FTM, FGA, FTA]


def _toy_reconciler() -> Reconciler:
    # A = scoring identity row; G = an arbitrary gain — apply() must enforce the
    # identity regardless of G because PTS is re-derived from the components.
    A = np.array([1.0, -2.0, -1.0, -1.0, 0.0, 0.0])
    G = np.array([0.5, -0.1, -0.05, -0.1, 0.05, -0.05])
    return Reconciler(TARGETS, A, G)


def test_apply_enforces_scoring_identity():
    rec = _toy_reconciler()
    # Deliberately incoherent rows: PTS far from 2·FGM+FG3M+FTM.
    Y = np.array([
        [30.0, 8.0, 2.0, 4.0, 15.0, 5.0],   # parts imply 22, PTS says 30
        [5.0, 9.0, 3.0, 6.0, 18.0, 7.0],    # parts imply 27, PTS says 5
    ])
    Yt = rec.apply(Y)
    pts, fgm, fg3, ftm = Yt[:, 0], Yt[:, 1], Yt[:, 2], Yt[:, 3]
    assert np.allclose(pts, 2 * fgm + fg3 + ftm, atol=1e-9)


def test_apply_keeps_makes_le_attempts_and_nonneg():
    rec = _toy_reconciler()
    Y = np.array([[40.0, 18.0, 6.0, 9.0, 12.0, 3.0]])  # makes > attempts on purpose
    Yt = rec.apply(Y)
    assert (Yt >= 0).all()
    assert Yt[0, rec.idx["FGA"]] >= Yt[0, rec.idx["FGM"]]
    assert Yt[0, rec.idx["FTA"]] >= Yt[0, rec.idx["FTM"]]
    assert Yt[0, rec.idx["FG3M"]] <= Yt[0, rec.idx["FGM"]]


def test_build_reconciler_drives_incoherence_to_zero(feature_matrix):
    # Reuse the synthetic feature matrix: fit trivial mean predictors, build the
    # reconciler, and confirm it reports near-zero post-reconciliation incoherence.
    from types import SimpleNamespace
    from model_stats_inference.training.reconcile import build_reconciler
    res = {}
    for t in TARGETS:
        sub = feature_matrix[feature_matrix[f"y_{t}"].notna()]
        y = sub[f"y_{t}"].astype(float)
        pred = np.full(len(y), float(y.mean()))   # constant predictor → leaves incoherence
        res[t] = SimpleNamespace(oof_true=y.to_numpy(), oof_pred=pred, oof_index=y.index.to_numpy())
    recon = build_reconciler(res)
    assert recon["targets"] == TARGETS
    assert recon["incoherence_after"] < 1e-8
    assert all(np.isfinite(v) for v in recon["gains"].values())


def test_live_inference_lines_are_coherent(store, models_dir):
    inf = LiveInference(store, models_dir)
    assert inf.reconciler is not None
    state = store.get_player_state(1)  # full-history synthetic player (eligible)
    opp = next(t for t in store.team_own_vectors["TEAM_ID"] if t != state.team_id)
    res = inf.predict(PredictionRequest(
        player_id=1, opponent_team_id=int(opp),
        is_home=True, game_date="2025-01-01", minutes=30.0))
    pts = res.stats["PTS"].value
    parts = 2 * res.stats["FGM"].value + res.stats["FG3M"].value + res.stats["FTM"].value
    assert abs(pts - parts) < 1e-6
    assert res.stats["FGM"].value <= res.stats["FGA"].value + 1e-9
