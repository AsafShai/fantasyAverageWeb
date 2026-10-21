"""Tests for the surprise scoring (synthetic frames, synthetic calibration)."""

from __future__ import annotations

from datetime import date

import numpy as np
import pandas as pd
import pytest
from pandas.testing import assert_frame_equal

from model_stats_inference.serving import surprise


def _history(pid: int, n: int, pts: float, season: str = "2025-26", seed: int = 0) -> pd.DataFrame:
    """n played games for one player around a scoring level; the last row is tonight."""
    rng = np.random.default_rng(seed)
    pts_series = np.clip(rng.normal(pts, 3.0, n), 0, None).round()
    fga = (pts_series / 1.0).round() + 5
    return pd.DataFrame({
        "PLAYER_ID": pid,
        "GAME_ID": [f"{pid}-{i:03d}" for i in range(n)],
        "SEASON": season,
        "GAME_DATE": pd.date_range("2025-10-22", periods=n, freq="2D"),
        "MIN": 30.0,
        "PTS": pts_series, "REB": 5.0, "AST": 3.0, "FG3M": 1.0, "FG3A": 3.0,
        "STL": 1.0, "BLK": 0.5, "FGM": (pts_series / 2.2).round(), "FGA": fga,
        "FTM": 2.0, "FTA": 3.0,
    })


def _calibration(df: pd.DataFrame) -> dict:
    """A calibration built from the frame itself (no model errors)."""
    for s in surprise.ERR_TARGETS:
        df[f"PRED_{s}"] = np.nan
    df = surprise.add_errors(df)
    return surprise.build_calibration(df, source="test"), df


class TestComputeZscores:
    def test_windows_exclude_tonight_and_need_full_history(self):
        z = surprise.compute_zscores(_history(1, 12, 15.0))
        # first game: nothing before it, every window is NaN
        first = z.iloc[0]
        assert np.isnan(first["PZ_ALL_PTS"]) and np.isnan(first["PZ_L5_PTS"])
        # sixth game: L5 has its full window, L10 not yet
        sixth = z.iloc[5]
        assert not np.isnan(sixth["PZ_L5_PTS"]) and np.isnan(sixth["PZ_L10_PTS"])
        assert not np.isnan(z.iloc[11]["PZ_L10_PTS"])

    def test_pearson_z_is_signed_by_tonight_vs_prior_mean(self):
        hist = _history(1, 11, 15.0)
        hist.loc[hist.index[-1], "PTS"] = 40.0
        z = surprise.compute_zscores(hist)
        assert z.iloc[-1]["PZ_SEASON_PTS"] > 3
        hist.loc[hist.index[-1], "PTS"] = 0.0
        z = surprise.compute_zscores(hist)
        assert z.iloc[-1]["PZ_SEASON_PTS"] < -2

    def test_season_window_restarts_each_season(self):
        a = _history(1, 10, 30.0, season="2024-25")
        b = _history(1, 1, 10.0, season="2025-26")
        b["GAME_DATE"] = pd.Timestamp("2025-12-01")
        b["GAME_ID"] = ["new"]
        z = surprise.compute_zscores(pd.concat([a, b]))
        last = z.iloc[-1]
        assert np.isnan(last["PZ_SEASON_PTS"])      # no prior game this season
        assert last["PZ_ALL_PTS"] < -2                # but a bad night against all his games

    def test_shooting_z_is_binomial_and_volume_aware(self):
        hist = _history(1, 11, 15.0)
        hist.loc[hist.index[-1], ["FGM", "FGA"]] = [0, 12]
        cold = surprise.compute_zscores(hist).iloc[-1]["PZ_SEASON_FG_PCT"]
        hist.loc[hist.index[-1], ["FGM", "FGA"]] = [0, 2]
        mild = surprise.compute_zscores(hist).iloc[-1]["PZ_SEASON_FG_PCT"]
        assert cold < mild < 0

    def test_with_means_adds_prior_season_average(self):
        z = surprise.compute_zscores(_history(1, 6, 20.0), with_means=True)
        assert "AVG_SEASON_PTS" in z.columns and "AVG_SEASON_FG_PCT" in z.columns
        assert np.isnan(z.iloc[0]["AVG_SEASON_PTS"])
        assert 10 < z.iloc[-1]["AVG_SEASON_PTS"] < 30


class TestNightZscores:
    def test_matches_compute_zscores_at_the_night_rows(self):
        """Players with long and short histories, two seasons, a scoreless 0/11
        night and a player with no prior game: every PZ_/AVG_ column equal."""
        frames = []
        for p in range(1, 9):
            n = [30, 12, 10, 6, 5, 3, 1, 0][p - 1]
            if n:
                a = _history(p, n, 12.0 + p, season="2024-25", seed=p)
                frames.append(a)
            b = _history(p, 1, 15.0, season="2025-26", seed=100 + p)
            b["GAME_DATE"] = pd.Timestamp("2026-01-15")   # after every history game
            b["GAME_ID"] = f"night-{p}"
            frames.append(b)
        # a second season game before the night for some players
        extra = _history(2, 3, 20.0, season="2025-26", seed=55)
        extra["GAME_DATE"] = pd.date_range("2025-12-25", periods=3, freq="7D")
        extra["GAME_ID"] = ["e1", "e2", "e3"]
        frames.append(extra)
        rows = pd.concat(frames, ignore_index=True)
        rows.loc[rows["GAME_ID"] == "night-3", ["FGM", "FGA"]] = [0, 11]
        rows.loc[rows["GAME_ID"] == "night-4", ["FTM", "FTA"]] = [0, 0]

        night = date(2026, 1, 15)
        fast = surprise.night_zscores(rows, night).set_index("PLAYER_ID")
        slow = surprise.compute_zscores(rows, with_means=True)
        slow = slow[slow["GAME_ID"].str.startswith("night-")].set_index("PLAYER_ID")
        cols = [c for c in fast.columns if c != "GAME_ID"]
        assert set(cols) == {c for c in slow.columns if c.startswith(("PZ_", "AVG_"))}
        assert_frame_equal(fast[cols].sort_index(), slow[cols].sort_index(), check_dtype=False, check_names=False)
        assert np.isnan(fast.at[8, "PZ_ALL_PTS"])            # no prior game at all
        assert np.isnan(fast.at[5, "PZ_L10_PTS"])            # only 5 priors: no L10
        assert not np.isnan(fast.at[5, "PZ_L5_PTS"])


class TestScoring:
    def test_big_night_scores_positive_and_cold_night_negative(self):
        frames = [_history(p, 15, 15.0, seed=p) for p in range(1, 9)]
        hist = pd.concat(frames, ignore_index=True)
        hist.loc[hist["GAME_ID"] == "1-014", ["PTS", "FGM", "FGA"]] = [45, 18, 25]
        hist.loc[hist["GAME_ID"] == "2-014", ["PTS", "FGM", "FGA"]] = [0, 0, 11]
        z = surprise.compute_zscores(hist)
        df = hist.merge(z, on=["PLAYER_ID", "GAME_ID"])
        calibration, df = _calibration(df)
        scored = surprise.score_frame(df, calibration)
        by_game = scored.set_index(df["GAME_ID"])
        assert by_game.at["1-014", "SCORE"] > 1.5
        assert by_game.at["2-014", "SCORE"] < -1.5
        assert not by_game["HAS_ESTIMATE"].any()      # no predictions anywhere
        assert abs(scored["SCORE"].mean()) < 0.3       # ~N(0,1) against its own reference

    def test_model_error_only_counts_with_a_prediction(self):
        hist = pd.concat([_history(p, 12, 15.0, seed=p) for p in range(1, 5)], ignore_index=True)
        z = surprise.compute_zscores(hist)
        df = hist.merge(z, on=["PLAYER_ID", "GAME_ID"])
        calibration, df = _calibration(df)
        # give one row a prediction far below the actual
        idx = df.index[df["GAME_ID"] == "1-011"][0]
        for s in surprise.ERR_TARGETS:
            df.at[idx, f"PRED_{s}"] = 0.0
        df = surprise.add_errors(df)
        calibration["norm"].update({f"ERR_{s}": {"mean": 0.0, "std": 5.0} for s in surprise.ERR_WEIGHTS})
        scored = surprise.score_frame(df, calibration)
        assert scored.at[idx, "HAS_ESTIMATE"]
        assert scored["HAS_ESTIMATE"].sum() == 1
        assert scored.at[idx, "METRIC_ERR"] > 0

    def test_reasons_follow_the_verdict_sign(self):
        hist = pd.concat([_history(p, 12, 15.0, seed=p) for p in range(1, 5)], ignore_index=True)
        hist.loc[hist["GAME_ID"] == "1-011", ["PTS", "REB"]] = [40, 15]
        z = surprise.compute_zscores(hist, with_means=True)
        df = hist.merge(z, on=["PLAYER_ID", "GAME_ID"])
        calibration, df = _calibration(df)
        scored = surprise.score_frame(df, calibration)
        reasons = surprise.reasons_for(df, scored, calibration)
        idx = df.index[df["GAME_ID"] == "1-011"][0]
        stats = [r["stat"] for r in reasons[idx]]
        assert stats[:2] in (["PTS", "REB"], ["REB", "PTS"])
        assert all(r["z"] > 0 for r in reasons[idx])
        assert reasons[idx][0]["value"] in (40.0, 15.0)
        assert reasons[idx][0]["avg"] is not None
        assert len(reasons[idx]) <= surprise.N_REASONS

    def test_calibration_lists_every_required_column(self):
        hist = pd.concat([_history(p, 12, 15.0, seed=p) for p in range(1, 4)], ignore_index=True)
        z = surprise.compute_zscores(hist)
        df = hist.merge(z, on=["PLAYER_ID", "GAME_ID"])
        calibration, _ = _calibration(df)
        assert set(surprise.required_columns()) - set(calibration["norm"]) == set()
        assert len(calibration["final_quantiles"]) == len(calibration["z_only_quantiles"]) == 1001

    def test_shipped_calibration_matches_the_frozen_settings(self):
        calibration = surprise.load_calibration()
        assert calibration["settings"]["z_weights"] == surprise.Z_WEIGHTS
        assert calibration["settings"]["err_weights"] == surprise.ERR_WEIGHTS
        assert calibration["settings"]["blend"] == surprise.BLEND
        assert set(surprise.required_columns()) <= set(calibration["norm"])


def test_weighted_metric_ignores_missing_components_but_not_all_missing():
    df = pd.DataFrame({"NORM_A": [1.0, np.nan, np.nan], "NORM_B": [1.0, 2.0, np.nan]})
    m = surprise.weighted_metric(df, {"A": 1.0, "B": 1.0})
    assert m.iloc[0] == pytest.approx(1.0)
    assert m.iloc[1] == pytest.approx(1.0)
    assert np.isnan(m.iloc[2])
