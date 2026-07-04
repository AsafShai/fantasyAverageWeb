"""LiveInference tests: end-to-end prediction off the feature store using only
features, plus the product guarantees (minutes monotonicity, derived %s, errors).

Run: uv run pytest model_stats_inference/serving/test_inference.py
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from model_stats_inference.serving.errors import (
    InsufficientHistoryError,
    ModelsNotTrainedError,
)
from model_stats_inference.serving.inference import LiveInference, PredictionRequest
from model_stats_inference.serving.conftest import FULL_PID, LOW_PID, TEAM_B


def _request(pid, minutes, store):
    state = store.player_vectors.loc[pid]
    game_date = pd.Timestamp(state["last_game_date"]) + pd.Timedelta(days=2)
    return PredictionRequest(
        player_id=pid, opponent_team_id=TEAM_B, is_home=True,
        game_date=game_date, minutes=minutes,
    )


def test_predict_returns_all_stats(store, models_dir):
    inf = LiveInference(store, models_dir=models_dir)
    res = inf.predict(_request(FULL_PID, 30, store))
    for stat in ["PTS", "REB", "AST", "FG3M", "STL", "BLK", "FG_PCT", "FT_PCT"]:
        assert stat in res.stats
        v = res.stats[stat].value
        assert np.isfinite(v) and v >= 0


def test_more_minutes_more_points(store, models_dir):
    inf = LiveInference(store, models_dir=models_dir)
    low = inf.predict(_request(FULL_PID, 20, store)).stats["PTS"].value
    high = inf.predict(_request(FULL_PID, 40, store)).stats["PTS"].value
    assert high > low


def test_rmse_band_present(store, models_dir):
    inf = LiveInference(store, models_dir=models_dir)
    pts = inf.predict(_request(FULL_PID, 30, store)).stats["PTS"]
    assert pts.low is not None and pts.high is not None
    assert pts.low <= pts.value <= pts.high


def test_fg_pct_is_ratio_in_range(store, models_dir):
    inf = LiveInference(store, models_dir=models_dir)
    res = inf.predict(_request(FULL_PID, 30, store))
    fgm, fga = res.stats["FGM"].value, res.stats["FGA"].value
    assert 0.0 <= res.stats["FG_PCT"].value <= 1.0
    if fga > 0:
        assert res.stats["FG_PCT"].value == pytest.approx(min(1.0, fgm / fga), rel=1e-6)


def test_low_history_player_refused(store, models_dir):
    inf = LiveInference(store, models_dir=models_dir)
    with pytest.raises(InsufficientHistoryError):
        inf.predict(_request(LOW_PID, 30, store))


def test_no_models_raises(store, tmp_path):
    with pytest.raises(ModelsNotTrainedError):
        LiveInference(store, models_dir=tmp_path)
