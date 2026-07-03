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

from sklearn.base import BaseEstimator
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.impute import SimpleImputer
from sklearn.linear_model import Ridge
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from . import config as _cfg

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
