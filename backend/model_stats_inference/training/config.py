"""Training configuration: paths, CV settings and the model factory.

Reuses the research config for the shared things (targets, feature-matrix path,
history filter) so training and research never drift apart.
"""

from __future__ import annotations

from pathlib import Path

from sklearn.ensemble import HistGradientBoostingRegressor

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


def make_model() -> HistGradientBoostingRegressor:
    """The estimator used for every target. Swap here to change model family.

    HistGradientBoosting handles NaNs natively (no imputation needed) and models
    the nonlinear minutes/rate interactions well.
    """
    return HistGradientBoostingRegressor(
        max_iter=400,
        learning_rate=0.05,
        max_leaf_nodes=31,
        l2_regularization=1.0,
        early_stopping=True,
        validation_fraction=0.1,
        random_state=RANDOM_STATE,
    )
