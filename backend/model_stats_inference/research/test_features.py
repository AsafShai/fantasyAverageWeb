"""Tests for the leakage-safe windowing engine.

Run: uv run pytest model_stats_inference/research/test_features.py
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from model_stats_inference.research import config
from model_stats_inference.research.features import compute_history_features


def _player(dates_days: list[int], pts: list[float], mins: list[float]) -> pd.DataFrame:
    base = pd.Timestamp("2024-01-01")
    return pd.DataFrame(
        {
            "PLAYER_ID": 1,
            "GAME_DATE": [base + pd.Timedelta(days=d) for d in dates_days],
            "PTS": pts,
            "MIN": mins,
        }
    )


def test_global_mean_is_shifted_no_leakage():
    df = _player([0, 1, 2, 3], pts=[10, 20, 30, 40], mins=[10, 10, 10, 10])
    f = compute_history_features(df, "PLAYER_ID", ["PTS"], ["PTS"], "")
    m = f["PTS_global_mean"].to_numpy()
    # first game has no prior history -> NaN; each later row excludes itself.
    assert np.isnan(m[0])
    assert m[1] == pytest.approx(10.0)
    assert m[2] == pytest.approx(15.0)   # mean(10, 20)
    assert m[3] == pytest.approx(20.0)   # mean(10, 20, 30)  -- 40 never leaks in


def test_global_rate_is_sum_over_minutes():
    df = _player([0, 1, 2], pts=[10, 20, 30], mins=[10, 10, 10])
    f = compute_history_features(df, "PLAYER_ID", ["PTS"], ["PTS"], "")
    r = f["PTS_global_rate"].to_numpy()
    assert r[1] == pytest.approx(10 / 10)
    assert r[2] == pytest.approx((10 + 20) / (10 + 10))


def test_global_variance_sample():
    df = _player([0, 1, 2, 3], pts=[10, 20, 30, 40], mins=[10, 10, 10, 10])
    f = compute_history_features(df, "PLAYER_ID", ["PTS"], ["PTS"], "")
    v = f["PTS_global_var"].to_numpy()
    assert np.isnan(v[0]) and np.isnan(v[1])     # need >=2 prior games
    assert v[2] == pytest.approx(np.var([10, 20], ddof=1))   # = 50
    assert v[3] == pytest.approx(np.var([10, 20, 30], ddof=1))  # = 100


def test_recency_cap_excludes_stale_games():
    # 5-game window is capped to 30 days; the last prior game is 98 days old.
    assert config.WINDOWS["w5"]["days"] == 30
    df = _player([0, 1, 2, 100], pts=[10, 20, 30, 1000], mins=[10, 10, 10, 10])
    f = compute_history_features(df, "PLAYER_ID", ["PTS"], ["PTS"], "")
    # global still sees all prior games...
    assert f["PTS_global_mean"].to_numpy()[3] == pytest.approx(20.0)
    # ...but the 30-day window has no qualifying prior game -> NaN.
    assert np.isnan(f["PTS_w5_mean"].to_numpy()[3])


def test_count_cap_keeps_last_n():
    # w5 keeps only the last 5 games; with daily games the day-cap doesn't bind.
    pts = list(range(1, 9))            # 8 games: 1..8
    df = _player(list(range(8)), pts=pts, mins=[1] * 8)
    f = compute_history_features(df, "PLAYER_ID", ["PTS"], ["PTS"], "")
    # row 7 (value 8): last 5 prior games are values 3,4,5,6,7 -> mean 5
    assert f["PTS_w5_mean"].to_numpy()[7] == pytest.approx(np.mean([3, 4, 5, 6, 7]))
