"""Estimator registry — the single place that defines *which model + which loss*.

Each entry is a name -> factory that returns a **fresh, fully self-contained**
scikit-learn estimator (a bare regressor or a Pipeline). "Self-contained" matters:
the rest of the training/serving code only ever calls `.fit` / `.predict` and never
imputes or scales, so any estimator that needs preprocessing (e.g. linear models,
which can't ingest NaNs the way HistGradientBoosting can) must wrap it here.

To change the production model/loss, point `config.MODEL_NAME` at a registered key.
To add a new candidate, add one entry below — it then automatically shows up in the
`compare_models` bake-off.
"""

from __future__ import annotations

from typing import Callable

import numpy as np
from sklearn.base import BaseEstimator, RegressorMixin, clone
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.impute import SimpleImputer
from sklearn.linear_model import Ridge
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from . import config as _cfg


class ExposureRegressor(BaseEstimator, RegressorMixin):
    """Model a counting stat as ``minutes × per-minute-rate`` (Poisson exposure).

    Instead of predicting the per-game count directly, the wrapped ``base``
    estimator predicts the per-minute **rate**, and we multiply by the minutes
    ``t`` the player is expected to play::

        ŷ = t · base.predict(X)

    The base is trained on the rate target ``y / t`` with ``sample_weight = t``,
    which is exactly the Poisson likelihood with ``t`` as the exposure/offset
    (``E[y | x, t] = t · exp(η(x))``). ``t`` is read from a feature column
    (``exposure_col``); the base still receives the full feature row, so the rate
    itself may depend on minutes (usage/fatigue/blowout context).

    Two properties fall out of the functional form, independent of the base:

    * **Structural zero** — ``t = 0 ⇒ ŷ = 0`` exactly, for every stat. Minutes
      scaling is arithmetic, not something the trees must approximate.
    * **Monotonicity** — ``ŷ`` is non-decreasing in ``t`` (rate ≥ 0).

    Inputs are identical to predicting the count directly, so it is a drop-in for
    any count regressor; only the target parameterization changes.
    """

    def __init__(self, base: BaseEstimator, exposure_col: str = "T_MIN"):
        self.base = base
        self.exposure_col = exposure_col

    def _exposure(self, X) -> np.ndarray:
        if self.exposure_col not in getattr(X, "columns", []):
            raise KeyError(
                f"ExposureRegressor needs column {self.exposure_col!r} in X "
                f"(the minutes exposure); keep it in every feature set."
            )
        return np.asarray(X[self.exposure_col], dtype=float)

    def fit(self, X, y, sample_weight=None):
        t = self._exposure(X)
        m = t > 0  # rows with 0 minutes carry no rate signal (train pop is MIN>=5)
        self.base_ = clone(self.base)
        w = t[m] if sample_weight is None else t[m] * np.asarray(sample_weight, float)[m]
        rate = np.asarray(y, dtype=float)[m] / t[m]
        # X[m] preserves column names so the base records feature_names_in_.
        self.base_.fit(X[m], rate, sample_weight=w)
        return self

    def predict(self, X) -> np.ndarray:
        t = np.clip(self._exposure(X), 0.0, None)
        return t * self.base_.predict(X)

# Shared HistGradientBoosting hyperparameters (loss is set per-entry). HGB handles
# NaNs natively and models the nonlinear minutes/rate interactions well.
HGB_KW = dict(
    max_iter=400,
    learning_rate=0.05,
    max_leaf_nodes=31,
    l2_regularization=1.0,
    early_stopping=True,
    validation_fraction=0.1,
    random_state=_cfg.RANDOM_STATE,
)


ESTIMATORS: dict[str, Callable[[], BaseEstimator]] = {
    # Gradient-boosted trees, squared-error loss (the original baseline).
    "hgb_l2": lambda: HistGradientBoostingRegressor(loss="squared_error", **HGB_KW),
    # Same trees, Poisson loss — natural for non-negative count stats (var ~ mean).
    "hgb_poisson": lambda: HistGradientBoostingRegressor(loss="poisson", **HGB_KW),
    # Poisson trees wrapped as a minutes-exposure model: predicts a per-minute
    # rate and multiplies by t, so t=0 => 0 exactly and the rate scaling is arithmetic
    # rather than learned. Same inputs as hgb_poisson (the production model).
    "hgb_poisson_exposure": lambda: ExposureRegressor(
        HistGradientBoostingRegressor(loss="poisson", **HGB_KW)
    ),
    # Linear floor: median-impute (NaN-safe) + standardize + ridge regression.
    "linear": lambda: Pipeline(
        [
            ("impute", SimpleImputer(strategy="median")),
            ("scale", StandardScaler()),
            ("reg", Ridge(alpha=1.0, random_state=_cfg.RANDOM_STATE)),
        ]
    ),
}


def build_estimator(name: str) -> BaseEstimator:
    """Return a fresh estimator for a registered name, or raise a clear error."""
    try:
        return ESTIMATORS[name]()
    except KeyError:
        raise KeyError(
            f"unknown estimator {name!r}; registered: {', '.join(ESTIMATORS)}"
        ) from None


def list_estimators() -> list[str]:
    return list(ESTIMATORS)
