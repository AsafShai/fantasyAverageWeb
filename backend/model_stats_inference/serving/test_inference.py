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


def test_assembled_row_has_new_blk_features(store, models_dir):
    # The row handed to the models must carry the EWM/bio features, and the
    # generic T_x loop must synthesize the minutes interaction for EWM rates.
    inf = LiveInference(store, models_dir=models_dir)
    req = _request(FULL_PID, 30, store)
    state = store.get_player_state(req.player_id)
    own = store.get_team_state(state.team_id)
    opp = store.get_team_state(req.opponent_team_id)
    row = inf._assemble_row(state, own, opp, req)
    assert np.isfinite(row["BLK_ewm5_mean"])
    assert "HEIGHT_IN" in row
    assert row["T_x_BLK_ewm5_rate"] == pytest.approx(30 * row["BLK_ewm5_rate"])


def test_model_with_missing_store_feature_degrades_gracefully(store, models_dir, tmp_path):
    # A model can ship with features older stored vectors don't carry yet (e.g.
    # right after a deploy, before the nightly re-materialization). Prediction
    # must fall back to NaN for those features, not KeyError the batch.
    import joblib

    payload = joblib.load(models_dir / "BLK.joblib")
    payload["features"] = payload["features"] + ["SOME_FUTURE_FEATURE"]
    # HGB must know the extra column at fit time for names to match; retrain the
    # tiny model with an all-NaN extra column.
    import numpy as np
    import pandas as pd
    from model_stats_inference.training import models as registry

    n = 50
    rng = np.random.default_rng(0)
    X = pd.DataFrame(rng.uniform(0, 30, size=(n, len(payload["features"]))),
                     columns=payload["features"])
    # trained with a partially-missing column (like real bio/anthro coverage) ...
    X.loc[X.index[: n // 2], "SOME_FUTURE_FEATURE"] = np.nan
    y = X.iloc[:, 0] * 0.03
    payload["model"] = registry.build_estimator("hgb_l2").fit(X, y)
    out = tmp_path / "models"
    out.mkdir()
    joblib.dump(payload, out / "BLK.joblib")

    inf = LiveInference(store, models_dir=out)
    res = inf.predict(_request(FULL_PID, 30, store))
    assert np.isfinite(res.stats["BLK"].value)


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
