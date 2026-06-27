"""Serving configuration. Reuses research/training config so nothing drifts."""

from __future__ import annotations

from pathlib import Path

from ..research import config as rconfig
from ..training import config as tconfig

# Minimum games of history required to make a live prediction. Below this the
# store raises InsufficientHistoryError (early season / rookies / just-traded).
MIN_INFERENCE_GAMES = 10

# Where the materialized feature store is cached (parquet now; DB-ready later).
STORE_DIR = Path(__file__).parent / "store"

MODELS_DIR = tconfig.MODELS_DIR
TARGETS = rconfig.TARGETS
