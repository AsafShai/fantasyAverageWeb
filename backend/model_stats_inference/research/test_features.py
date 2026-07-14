"""Tests for the leakage-safe windowing engine.

Run: uv run pytest model_stats_inference/research/test_features.py
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from model_stats_inference.research import config
from model_stats_inference.research.features import (
    _bio_features,
    compute_ewm_features,
    compute_history_features,
)


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


# --- EWM block features ------------------------------------------------------

def _blk_player(blk: list[float], mins: list[float] | None = None) -> pd.DataFrame:
    df = _player(list(range(len(blk))), pts=[0.0] * len(blk), mins=mins or [10.0] * len(blk))
    df["BLK"] = blk
    # compute_ewm_features consumes every stat in config.EWM_STATS.
    for stat in config.EWM_STATS:
        if stat not in df.columns:
            df[stat] = 0.0
    return df


def test_ewm_shifted_no_leakage():
    df = _blk_player([1, 2, 3, 4])
    f = compute_ewm_features(df, shifted=True)
    m = f["BLK_ewm5_mean"].to_numpy()
    # first game has no prior history; row 1 sees only game 0.
    assert np.isnan(m[0])
    assert m[1] == pytest.approx(1.0)
    # row 3 must not include its own value (4): ewm over [1, 2, 3] only.
    expected = pd.Series([1.0, 2.0, 3.0]).ewm(halflife=5, min_periods=1).mean().iloc[-1]
    assert m[3] == pytest.approx(expected)


def test_ewm_asof_includes_last_game():
    df = _blk_player([1, 2, 3, 4])
    f = compute_ewm_features(df, shifted=False)
    expected = pd.Series([1.0, 2.0, 3.0, 4.0]).ewm(halflife=5, min_periods=1).mean().iloc[-1]
    assert f["BLK_ewm5_mean"].to_numpy()[-1] == pytest.approx(expected)


def test_ewm_asof_last_row_equals_shifted_next_game():
    # The as-of value after game i must equal what the shifted (training) path
    # would compute for a hypothetical game i+1 — serving/training consistency.
    df = _blk_player([0, 1, 0, 2, 1])
    asof = compute_ewm_features(df, shifted=False)["BLK_ewm15_rate"].to_numpy()[-1]
    df_next = _blk_player([0, 1, 0, 2, 1, 99])   # value of the next game is irrelevant
    shifted = compute_ewm_features(df_next, shifted=True)["BLK_ewm15_rate"].to_numpy()[-1]
    assert asof == pytest.approx(shifted)


def test_ewm_share_counts_games_with_a_block():
    df = _blk_player([0, 2, 0, 1])
    f = compute_ewm_features(df, shifted=True)
    # global share is a plain expanding mean of the >=1 indicator, shifted.
    s = f["BLK_share_global"].to_numpy()
    assert np.isnan(s[0])
    assert s[1] == pytest.approx(0.0)        # prior games: [0]
    assert s[2] == pytest.approx(0.5)        # prior games: [0, 2]
    assert s[3] == pytest.approx(1 / 3)      # prior games: [0, 2, 0]


def test_ewm_rate_is_per_minute():
    df = _blk_player([2, 2], mins=[20.0, 40.0])
    f = compute_ewm_features(df, shifted=True)
    assert f["BLK_ewm5_rate"].to_numpy()[1] == pytest.approx(2 / 20)


def test_share_uses_per_stat_threshold():
    # REB share counts games with >= EWM_SHARE_MIN['REB'] (6), not >= 1.
    df = _blk_player([0, 0, 0, 0])
    df["REB"] = [4, 6, 8, 2]
    f = compute_ewm_features(df, shifted=True)
    s = f["REB_share_global"].to_numpy()
    assert np.isnan(s[0])
    assert s[1] == pytest.approx(0.0)      # prior: [4]     -> 0 games >= 6
    assert s[2] == pytest.approx(0.5)      # prior: [4,6]   -> 1 of 2
    assert s[3] == pytest.approx(2 / 3)    # prior: [4,6,8] -> 2 of 3


def test_ewm_covers_every_configured_stat():
    df = _blk_player([1, 2, 3])
    f = compute_ewm_features(df, shifted=True)
    for stat in config.EWM_STATS:
        for col in (f"{stat}_ewm5_mean", f"{stat}_ewm15_rate",
                    f"{stat}_share_ewm{config.EWM_SHARE_HALFLIFE}", f"{stat}_share_global"):
            assert col in f.columns


def test_bio_features_align_and_handle_missing():
    ids = pd.Series([100, 200, 300])
    bio = pd.DataFrame({
        "PLAYER_ID": [100, 300],
        "HEIGHT_IN": [80.0, 84.0], "WEIGHT_LB": [220.0, 250.0],
        "WINGSPAN_IN": [85.0, np.nan], "REACH_IN": [106.0, np.nan],
        "WING_MINUS_HEIGHT": [5.0, np.nan],
    })
    f = _bio_features(ids, bio)
    assert f["HEIGHT_IN"].tolist()[0] == 80.0
    assert np.isnan(f["HEIGHT_IN"].to_numpy()[1])      # unknown player -> NaN
    assert f["HEIGHT_IN"].tolist()[2] == 84.0
    # no artifact at all -> all-NaN frame with the full column set.
    empty = _bio_features(ids, None)
    assert list(empty.columns) == config.BIO_COLUMNS
    assert empty.isna().all().all()
