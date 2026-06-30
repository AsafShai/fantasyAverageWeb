"""Build the MinT reconciler from cross-validation residuals.

The 6 shooting models (PTS, FGM, FG3M, FTM, FGA, FTA) are trained independently, so
their predictions don't obey the scoring identity  PTS = 2·FGM + FG3M + FTM.  MinT
optimal reconciliation projects a raw prediction vector onto the coherent subspace
{y : A y = 0}, in the metric of the models' error covariance W, via the fixed gain

    G = W Aᵀ (A W Aᵀ)⁻¹            ->     ỹ = ŷ − G · (A ŷ)

The only thing estimated from data is W — and it comes straight from the k-fold
out-of-fold (OOF) residuals we already compute during training (no extra fitting).
W's off-diagonal (e.g. Cov(e_FGA, e_FGM)) is what makes attempts follow makes; using
the full W (not W = I) is the whole reason the adjustment is "smart".

See docs/RECONCILIATION.md for the full derivation.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.covariance import LedoitWolf

# Order of the reconciled vector. REB/AST/STL/BLK are intentionally excluded — the
# scoring identity doesn't touch them, so they pass through unreconciled.
SHOOTING_TARGETS = ["PTS", "FGM", "FG3M", "FTM", "FGA", "FTA"]

# Scoring identity row A:  PTS − 2·FGM − FG3M − FTM = 0  (coefficients in SHOOTING_TARGETS order).
_A_COEFFS = {"PTS": 1.0, "FGM": -2.0, "FG3M": -1.0, "FTM": -1.0, "FGA": 0.0, "FTA": 0.0}


def build_reconciler(results: dict) -> dict:
    """Estimate W from OOF residuals and precompute the MinT gain G.

    `results` maps target -> TrainResult (with `.oof_true`, `.oof_pred`, `.oof_index`).
    Returns a payload {targets, A, G, W, n_rows, incoherence_before/after} ready to
    joblib-dump and apply at inference.
    """
    # Align each shooting target's OOF residual by row key, inner-join on common rows.
    resid_cols = {}
    for t in SHOOTING_TARGETS:
        r = results[t]
        resid = np.asarray(r.oof_true, float) - np.asarray(r.oof_pred, float)
        resid_cols[t] = pd.Series(resid, index=np.asarray(r.oof_index))
    R = pd.DataFrame(resid_cols).dropna()          # rows × 6, only rows present for all 6
    R = R[SHOOTING_TARGETS]                         # enforce column order

    # Error covariance W (Ledoit–Wolf shrinkage → well-conditioned, invertible).
    W = LedoitWolf().fit(R.to_numpy()).covariance_   # 6×6
    A = np.array([_A_COEFFS[t] for t in SHOOTING_TARGETS], float)    # (6,)

    WAt = W @ A                                      # (6,)
    denom = float(A @ WAt)                           # scalar  A W Aᵀ
    G = WAt / denom                                  # (6,)  gain vector

    # Diagnostics: how incoherent the raw OOF predictions are, before vs after reco.
    pred_cols = {t: pd.Series(np.asarray(results[t].oof_pred, float),
                              index=np.asarray(results[t].oof_index)) for t in SHOOTING_TARGETS}
    P = pd.DataFrame(pred_cols).dropna()[SHOOTING_TARGETS].to_numpy()
    inc_before = P @ A                               # PTS − 2FGM − FG3M − FTM per row
    inc_after = (P - np.outer(inc_before, G)) @ A

    return {
        "targets": SHOOTING_TARGETS,
        "A": A,                                       # 6
        "G": G,                                       # 6
        "W": W,                                        # 6×6
        "n_rows": int(len(R)),
        "incoherence_before": float(np.mean(np.abs(inc_before))),
        "incoherence_after": float(np.mean(np.abs(inc_after))),
        "gains": {t: float(g) for t, g in zip(SHOOTING_TARGETS, G)},
    }
