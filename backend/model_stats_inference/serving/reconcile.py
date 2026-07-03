"""Apply the MinT reconciler at inference time.

Loads the gain `G` and constraint `A` baked in training and projects raw shooting
predictions onto the coherent subspace (PTS = 2·FGM + FG3M + FTM), vectorized over a
batch of players. The error covariance was learned in training; here it's a single
matrix op. See docs/RECONCILIATION.md.
"""

from __future__ import annotations

from pathlib import Path

import joblib
import numpy as np


class Reconciler:
    """Holds the fixed projection (targets, A, G) and applies it to a batch."""

    def __init__(self, targets: list[str], A: np.ndarray, G: np.ndarray):
        self.targets = list(targets)
        self.A = np.asarray(A, float).reshape(-1)   # 6
        self.G = np.asarray(G, float).reshape(-1)   # 6
        self.idx = {t: i for i, t in enumerate(self.targets)}

    @classmethod
    def load(cls, path: Path) -> "Reconciler | None":
        if not Path(path).exists():
            return None
        p = joblib.load(path)
        return cls(p["targets"], p["A"], p["G"])

    def apply(self, Y: np.ndarray) -> np.ndarray:
        """Reconcile a (n_players × 6) matrix in `self.targets` order.

        ỹ = ŷ − G · (A ŷ); then clip ≥0 and enforce make ≤ attempt and FG3M ≤ FGM.
        """
        Y = np.asarray(Y, float)
        inc = Y @ self.A                      # (n,)  PTS − 2FGM − FG3M − FTM per player
        Yt = Y - np.outer(inc, self.G)        # (n, 6)
        np.clip(Yt, 0.0, None, out=Yt)

        # Structural sanity: makes can't exceed attempts; threes ⊆ field goals.
        i = self.idx
        if {"FGM", "FGA"} <= i.keys():
            Yt[:, i["FGA"]] = np.maximum(Yt[:, i["FGA"]], Yt[:, i["FGM"]])
        if {"FTM", "FTA"} <= i.keys():
            Yt[:, i["FTA"]] = np.maximum(Yt[:, i["FTA"]], Yt[:, i["FTM"]])
        if {"FG3M", "FGM"} <= i.keys():
            Yt[:, i["FG3M"]] = np.minimum(Yt[:, i["FG3M"]], Yt[:, i["FGM"]])

        # Derive PTS from the final (clipped/clamped) components so the scoring
        # identity holds EXACTLY even after the structural fixes above. Equivalent to
        # the reconciled PTS when nothing clipped; restores coherence when it did.
        if {"PTS", "FGM", "FG3M", "FTM"} <= i.keys():
            Yt[:, i["PTS"]] = 2.0 * Yt[:, i["FGM"]] + Yt[:, i["FG3M"]] + Yt[:, i["FTM"]]
        return Yt
