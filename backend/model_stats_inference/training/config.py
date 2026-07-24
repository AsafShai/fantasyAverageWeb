"""Training configuration: paths, CV settings and the model factory.

Reuses the research config for the shared things (targets, feature-matrix path,
history filter) so training and research never drift apart.
"""

from __future__ import annotations

from pathlib import Path

from sklearn.base import BaseEstimator

from ..research import config as rconfig

# --- Paths -----------------------------------------------------------------

ROOT = Path(__file__).parent
FEATURE_SETS_DIR = ROOT / "feature_sets"          # one file per model
OUTPUT_DIR = ROOT / "outputs"                      # plots + metrics
MODELS_DIR = ROOT.parent / "models"               # saved estimators

FEATURE_MATRIX = rconfig.DATA_DIR / "feature_matrix.parquet"
SELECTED_JSON = rconfig.OUTPUT_DIR / "selected_features.json"

# --- Shared with research --------------------------------------------------

TARGETS = rconfig.TARGETS
TARGET_PREFIX = "y_"
MIN_HISTORY_GAMES = rconfig.MIN_HISTORY_GAMES

# --- Cross-validation ------------------------------------------------------

KFOLDS = 5
RANDOM_STATE = 0

# Counting-stat targets are clipped at 0 at predict time (can't be negative).
CLIP_AT_ZERO = True

# --- Model selection -------------------------------------------------------

# The production model/loss. Must be a key in `training.models.ESTIMATORS`.
# Change this one line to swap model family or loss; add new candidates in
# training/models.py (they auto-appear in the compare_models bake-off).
#
# hgb_poisson_exposure models each stat as minutes × per-minute-rate (ŷ = t·rate):
# t=0 ⇒ 0 exactly, monotone in minutes, and a small consistent RMSE gain over the
# bare hgb_poisson count model on identical inputs. See docs/MINUTES_EXPOSURE.md.
MODEL_NAME = "hgb_poisson_exposure"


def make_model() -> BaseEstimator:
    """The estimator used for every target. Swap via `MODEL_NAME` above.

    Delegates to the registry in `training.models`; imported lazily so that
    module (which imports this config) doesn't create a circular import.
    """
    from . import models

    return models.build_estimator(MODEL_NAME)
