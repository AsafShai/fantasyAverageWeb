"""Live inference: predict a player's next-game stat line from the feature store.

Given an upcoming game (player, opponent, home/away, date) and the minutes ``t``
the player is expected to play, assemble the feature row from the store, set the
minutes-dependent features, and run each per-stat model.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

from . import config
from .errors import InsufficientHistoryError, ModelsNotTrainedError, UnknownPlayerError
from .feature_store import FeatureStore
from .reconcile import Reconciler


@dataclass
class PredictionRequest:
    player_id: int
    opponent_team_id: int
    is_home: bool
    game_date: str | pd.Timestamp
    minutes: float  # t — expected minutes the player will play


@dataclass
class StatPrediction:
    value: float
    low: float | None = None   # value - RMSE
    high: float | None = None  # value + RMSE


@dataclass
class PredictionResult:
    player_id: int
    minutes: float
    stats: dict[str, StatPrediction] = field(default_factory=dict)


class LiveInference:
    """Loads the trained per-stat models and serves predictions off a FeatureStore."""

    def __init__(self, store: FeatureStore, models_dir: Path | None = None):
        self.store = store
        self.models: dict[str, dict] = {}
        d = models_dir or config.MODELS_DIR
        for path in sorted(Path(d).glob("*.joblib")):
            if path.name == "reconciler.joblib":
                continue
            payload = joblib.load(path)
            self.models[payload["target"]] = payload
        # Learned color scale (spread of the Pearson residual) per target, if present.
        self.resid_sigma: dict[str, float] = {
            t: p.get("metrics", {}).get("resid_sigma")
            for t, p in self.models.items()
            if p.get("metrics", {}).get("resid_sigma") is not None
        }
        if not self.models:
            raise ModelsNotTrainedError(
                f"no models found in {d} — run `python -m model_stats_inference.training.train`"
            )
        # MinT reconciler (coherent shooting lines: PTS = 2·FGM + FG3M + FTM).
        # Optional — absent reconciler.joblib just skips reconciliation.
        self.reconciler = Reconciler.load(Path(d) / "reconciler.joblib")

    def predict(self, req: PredictionRequest) -> PredictionResult:
        results, errors = self.predict_many([req])
        if errors[0] is not None:
            raise errors[0]
        return results[0]  # type: ignore[return-value]

    def predict_many(
        self, reqs: list[PredictionRequest]
    ) -> tuple[list[PredictionResult | None], list[Exception | None]]:
        """Vectorized prediction for many requests at once.

        Assembles every eligible request into a single DataFrame and calls each
        model's ``.predict`` once over the whole batch — instead of one DataFrame
        build plus ~N model calls *per player*. The per-row overhead (DataFrame
        construction + sklearn input validation) dominates single-row predicts, so
        batching is several times faster for a full slate while producing identical
        numbers. Results are aligned to ``reqs``; an ineligible/unknown player gets
        ``None`` in results and the raised error in ``errors``, so one bad player
        never aborts the batch.
        """
        results: list[PredictionResult | None] = [None] * len(reqs)
        errors: list[Exception | None] = [None] * len(reqs)

        rows: list[dict] = []
        valid: list[int] = []
        for i, req in enumerate(reqs):
            try:
                state = self.store.get_player_state(req.player_id)   # raises if insufficient
                own = self.store.get_team_state(state.team_id)
                opp = self.store.get_team_state(req.opponent_team_id)
            except (InsufficientHistoryError, UnknownPlayerError) as e:
                errors[i] = e
                continue
            rows.append(self._assemble_row(state, own, opp, req))
            valid.append(i)

        if not valid:
            return results, errors

        X = pd.DataFrame(rows)
        # One predict call per model over the whole batch (vs ~N per player).
        batched: dict[str, np.ndarray] = {}
        for target, payload in self.models.items():
            # reindex (not X[...]) so a model deployed with features the stored
            # vectors don't carry yet degrades to NaN (HGB-native) instead of
            # KeyError-ing the whole batch — vectors self-heal on the next
            # nightly re-materialization.
            vals = payload["model"].predict(X.reindex(columns=payload["features"]))
            if payload.get("clip_at_zero", True):
                vals = np.clip(vals, 0.0, None)
            batched[target] = vals

        # Reconcile the shooting block so PTS = 2·FGM + FG3M + FTM (coherent lines).
        # Overwrites those 6 targets in place; REB/AST/STL/BLK pass through untouched.
        if self.reconciler is not None and all(t in batched for t in self.reconciler.targets):
            Y = np.column_stack([batched[t] for t in self.reconciler.targets])
            Yt = self.reconciler.apply(Y)
            for k, t in enumerate(self.reconciler.targets):
                batched[t] = Yt[:, k]

        for j, i in enumerate(valid):
            req = reqs[i]
            result = PredictionResult(player_id=req.player_id, minutes=float(req.minutes))
            preds: dict[str, float] = {}
            for target, payload in self.models.items():
                value = float(batched[target][j])
                preds[target] = value
                rmse = payload.get("metrics", {}).get("rmse_mean")
                result.stats[target] = StatPrediction(
                    value=value,
                    low=max(0.0, value - rmse) if rmse is not None else None,
                    high=value + rmse if rmse is not None else None,
                )
            # Derived shooting percentages from predicted makes / attempts.
            result.stats["FG_PCT"] = StatPrediction(_safe_ratio(preds.get("FGM"), preds.get("FGA")))
            result.stats["FT_PCT"] = StatPrediction(_safe_ratio(preds.get("FTM"), preds.get("FTA")))
            results[i] = result

        return results, errors

    # --- feature-row assembly ---------------------------------------------

    def _assemble_row(self, state, own, opp, req: PredictionRequest) -> dict:
        game_date = pd.Timestamp(req.game_date)
        rest = (game_date - pd.Timestamp(state.last_game_date)).days

        row: dict[str, float] = {}
        row.update(state.vector.to_dict())   # player history mean/var/rate + efficiency
        row.update(own.own.to_dict())        # TEAM_* own-team context
        row.update(opp.allowed.to_dict())    # OPP_ALLOWED_* opponent context

        # Context.
        pos = state.position or ""
        row["IS_HOME"] = float(req.is_home)
        row["REST_DAYS"] = float(rest)
        row["IS_BACK_TO_BACK"] = float(rest == 1)
        row["HISTORY_GAMES"] = float(state.games_count)
        row["IS_GUARD"] = float("G" in pos)
        row["IS_FORWARD"] = float("F" in pos)
        row["IS_CENTER"] = float("C" in pos)

        # Minutes-dependent features: t and every t*rate.
        t = float(req.minutes)
        row["T_MIN"] = t
        for key in [k for k in row if k.endswith("_rate")]:
            row[f"T_x_{key}"] = t * row[key]
        return row


def _safe_ratio(num: float | None, den: float | None) -> float:
    if not num or not den or den <= 0:
        return 0.0
    return min(1.0, num / den)
