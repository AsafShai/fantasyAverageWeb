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
        assert set(cols) == {c for c in slow.columns if c.startswith(("PZ_", "AVG_")) or c == "SEASON_GAMES"}
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

    def test_reasons_lead_with_the_verdict_and_keep_both_signs(self):
        hist = pd.concat([_history(p, 12, 15.0, seed=p) for p in range(1, 5)], ignore_index=True)
        # a big night on points and rebounds, with a cold free-throw line on volume
        hist.loc[hist["GAME_ID"] == "1-011", ["PTS", "REB", "FTM", "FTA"]] = [40, 15, 0, 8]
        # and a 1-of-1 FG night elsewhere: the impact carries its own (tiny) volume
        hist.loc[hist["GAME_ID"] == "2-011", ["FGM", "FGA"]] = [1, 1]
        z = surprise.compute_zscores(hist, with_means=True)
        df = hist.merge(z, on=["PLAYER_ID", "GAME_ID"])
        calibration, df = _calibration(df)
        scored = surprise.score_frame(df, calibration)
        reasons = surprise.reasons_for(df, scored, calibration)
        big = reasons[df.index[df["GAME_ID"] == "1-011"][0]]
        assert big[0]["stat"] in ("PTS", "REB") and big[0]["z"] > 0      # headline matches the boom
        cold_line = {r["stat"]: r["z"] for r in big}.get("EFF_FT", 0)
        assert cold_line < 0                                              # the cold line is kept, negative
        assert big[0]["avg"] is not None and len(big) <= surprise.N_REASONS
        assert all(r["z"] >= surprise.MIN_REASON or r["z"] <= -surprise.MIN_REASON_BAD for r in big)
        small = reasons[df.index[df["GAME_ID"] == "2-011"][0]]
        assert abs({r["stat"]: r["z"] for r in small}.get("EFF_FG", 0)) < abs(cold_line)

    def test_calibration_lists_every_required_column(self):
        hist = pd.concat([_history(p, 12, 15.0, seed=p) for p in range(1, 4)], ignore_index=True)
        z = surprise.compute_zscores(hist)
        df = hist.merge(z, on=["PLAYER_ID", "GAME_ID"])
        calibration, _ = _calibration(df)
        assert set(surprise.required_columns()) - set(calibration["norm"]) == set()
        assert len(calibration["final_quantiles"]) == len(calibration["z_only_quantiles"]) == 1001

    def test_rows_without_an_estimate_are_ranked_among_rows_without_one(self):
        """Players with no model estimate get their own reference: the
        reference season's rows that had none either, not every row (those
        players' metric 1 is narrower; ranked among all rows they came out
        too narrow and leaning to booms)."""
        # players 3-4 (no estimate) score high, so their Pearson z is narrow next to players 1-2
        hist = pd.concat([_history(p, 60, 6.0 if p <= 2 else 45.0, seed=p) for p in range(1, 5)], ignore_index=True)
        z = surprise.compute_zscores(hist)
        df = hist.merge(z, on=["PLAYER_ID", "GAME_ID"])
        for s in surprise.ERR_TARGETS:
            df[f"PRED_{s}"] = np.where(df["PLAYER_ID"] <= 2, 1.0, np.nan)     # players 1-2 have an estimate
        df = surprise.add_errors(df)
        calibration = surprise.build_calibration(df, source="test")
        scored = surprise.score_frame(df, calibration)
        history_only = scored["METRIC_ERR"].isna() & scored["METRIC_Z"].notna()
        assert 0 < history_only.sum() < scored["METRIC_Z"].notna().sum()
        assert calibration["z_only_count"] == history_only.sum()
        own = scored.loc[history_only, "SCORE"]
        assert abs(own.median()) < 0.1                                          # centred on its own reference
        assert (own > 0).mean() == pytest.approx(0.5, abs=0.05)                # as many above as below
        assert (own.abs() >= 1).mean() == pytest.approx(0.317, abs=0.07)        # the bell curve's width, not squeezed

    def test_shipped_calibration_matches_the_frozen_settings(self):
        calibration = surprise.load_calibration()
        # every weight and rule it was trained under, so a change without a rebuild fails here
        assert calibration["settings"] == surprise.calibration_settings()
        assert set(surprise.required_columns()) <= set(calibration["norm"])


class TestShootingImpact:
    """EFF = makes - league rate x attempts: 0/0 neutral, volume scales it both ways."""

    @staticmethod
    def _eff(made: float, att: float, kind: str = "FG") -> float:
        row = pd.DataFrame({"FGM": [0.0], "FGA": [0.0], "FTM": [0.0], "FTA": [0.0]})
        row[f"{kind}M"], row[f"{kind}A"] = made, att
        return float(surprise.add_efficiency(row)[f"EFF_{kind}"].iloc[0])

    def test_neutral_at_nothing_and_at_the_league_rate(self):
        assert self._eff(0, 0) == 0 and self._eff(0, 0, "FT") == 0
        assert self._eff(1, 1) == pytest.approx(1 - surprise.LEAGUE_FG_PCT)
        assert self._eff(0, 1, "FT") == pytest.approx(-surprise.LEAGUE_FT_PCT)

    def test_volume_scales_it_both_ways(self):
        assert self._eff(8, 9) > self._eff(2, 2) > self._eff(1, 1) > 0
        assert self._eff(0, 9) < self._eff(0, 2) < 0
        assert self._eff(5, 10, "FT") < self._eff(0, 1, "FT")      # 50% from the line is a bad night

    def test_window_column_is_the_plain_difference_from_his_average(self):
        hist = _history(1, 12, 15.0)
        z = surprise.night_zscores(hist, hist["GAME_DATE"].iloc[-1].date())
        eff = surprise.add_efficiency(hist)["EFF_FG"]
        assert z["PZ_L5_EFF_FG"].iloc[0] == pytest.approx(eff.iloc[-1] - eff.iloc[-6:-1].mean())
        assert z["PZ_SEASON_EFF_FG"].iloc[0] == pytest.approx(eff.iloc[-1] - eff.iloc[:-1].mean())

    def test_model_error_comes_from_the_makes_and_attempts_estimates(self):
        df = pd.DataFrame({s: [10.0] for s in surprise.ERR_TARGETS})
        df["FGM"], df["FGA"], df["FTM"], df["FTA"] = 9.0, 17.0, 3.0, 3.0
        for s in surprise.ERR_TARGETS:
            df[f"PRED_{s}"] = {"FGM": 7.0, "FGA": 15.0, "FTM": 4.0, "FTA": 5.0}.get(s, 10.0)
        out = surprise.add_errors(df).iloc[0]
        assert out["ERR_EFF_FG"] == pytest.approx((9 - 7) - surprise.LEAGUE_FG_PCT * (17 - 15))
        assert out["ERR_EFF_FT"] == pytest.approx((3 - 4) - surprise.LEAGUE_FT_PCT * (3 - 5))


def test_per_stat_surprise_blends_like_the_final_and_falls_back_to_z():
    uz = pd.DataFrame({"PTS": [2.0, -2.0, 1.0], "REB": [0.0, 0.0, 0.5]})
    ue = pd.DataFrame({"PTS": [1.0, -1.0, np.nan], "REB": [np.nan, np.nan, np.nan]})
    out = surprise.per_stat_surprise(uz, ue)
    b = surprise.BLEND
    assert out.at[0, "PTS"] == pytest.approx((b["w1_pos"] * 2 + b["w2_pos"] * 1) / (b["w1_pos"] + b["w2_pos"]))
    assert out.at[1, "PTS"] == pytest.approx((b["w1_neg"] * -2 + b["w2_neg"] * -1) / (b["w1_neg"] + b["w2_neg"]))
    assert out.at[2, "PTS"] == 1.0 and out.at[2, "REB"] == 0.5     # no estimate: z alone


def test_blend_never_scores_a_worse_game_higher():
    """Worse metric 1 or worse model error never raises the score, and it has
    no jumps: when the two sides disagree they cancel toward 0."""
    jump = surprise.by_side(pd.Series([2.0, 2.0]), pd.Series([-0.667, -0.70]))
    assert jump.iloc[1] <= jump.iloc[0]                       # was 0 then 1.33 with a side picked by sign
    grid = np.linspace(-4, 4, 81)
    z, e = np.meshgrid(grid, grid, indexing="ij")
    out = surprise.by_side(pd.DataFrame(z), pd.DataFrame(e)).to_numpy()
    assert (np.diff(out, axis=0) >= -1e-12).all() and (np.diff(out, axis=1) >= -1e-12).all()
    step = grid[1] - grid[0]                                  # slope at most 1 either way: no jump
    assert np.abs(np.diff(out, axis=0)).max() <= step + 1e-9 and np.abs(np.diff(out, axis=1)).max() <= step + 1e-9


@pytest.mark.parametrize("season_games, shown", [(0, 20.0), (2, 20.0), (3, 10.0), (12, 10.0)])
def test_shown_average_waits_for_three_season_games(season_games, shown):
    row = pd.Series({"SEASON_GAMES": season_games, "AVG_SEASON_PTS": 10.0, "AVG_ALL_PTS": 20.0})
    assert surprise.shown_average(row, "PTS") == shown


def test_weighted_metric_ignores_missing_components_but_not_all_missing():
    df = pd.DataFrame({"NORM_A": [1.0, np.nan, np.nan], "NORM_B": [1.0, 2.0, np.nan]})
    m = surprise.weighted_metric(df, {"A": 1.0, "B": 1.0})
    assert m.iloc[0] == pytest.approx(1.0)
    assert m.iloc[1] == pytest.approx(1.0)
    assert np.isnan(m.iloc[2])


@pytest.mark.parametrize("prior_this_season", [1, 2, 10, 25])
def test_season_window_weight_grows_with_its_games(prior_this_season):
    """The season window always exists after one game, but its weight is
    min(games, 20)/20 of the full weight; both computations agree on the count."""
    last = _history(1, 20, 20.0, season="2025-26", seed=1)
    this = _history(1, prior_this_season + 1, 20.0, season="2026-27", seed=2)
    this["GAME_ID"] = [f"new-{i}" for i in range(len(this))]
    this["GAME_DATE"] = pd.date_range("2026-10-20", periods=len(this), freq="2D")
    rows = pd.concat([last, this], ignore_index=True)
    night = this["GAME_DATE"].iloc[-1].date()

    full = surprise.compute_zscores(rows, with_means=True)
    tonight_full = full[full["GAME_ID"] == this["GAME_ID"].iloc[-1]].iloc[0]
    tonight_night = surprise.night_zscores(rows, night).iloc[0]
    for row in (tonight_full, tonight_night):
        assert row["SEASON_GAMES"] == prior_this_season
        assert pd.notna(row["PZ_SEASON_PTS"])
    frame = pd.DataFrame([tonight_night])
    assert surprise.season_factor(frame).iloc[0] == pytest.approx(min(prior_this_season, 20) / 20)

    # the parquet helper counts the same way
    counted = surprise.add_season_games(rows.assign(MIN=30.0))
    assert counted["SEASON_GAMES"].iloc[-1] == prior_this_season


def test_season_weight_scales_only_season_columns():
    """weighted_metric scales the season columns by the row's factor and leaves
    the others; the denominator stays the full weight."""
    df = pd.DataFrame({"NORM_PZ_SEASON_PTS": [1.0, 1.0], "NORM_PZ_L10_PTS": [1.0, 1.0], "SEASON_GAMES": [1, 20]})
    m = surprise.weighted_metric(df, {"PZ_SEASON_PTS": 0.5, "PZ_L10_PTS": 1.0})
    assert list(m.round(4)) == [round((0.5 * 0.05 + 1.0) / 1.5, 4), 1.0]


def test_window_weights_lean_on_recent_form():
    m1, _ = surprise.metric_columns()
    assert surprise.WINDOW_WEIGHTS == {"ALL": 0.1, "SEASON": 0.5, "L10": 1.0, "L5": 0.5}
    assert m1["PZ_ALL_PTS"] == pytest.approx(0.1)
    assert m1["PZ_SEASON_PTS"] == m1["PZ_L5_PTS"] == 0.5 and m1["PZ_L10_PTS"] == 1.0


def test_blend_leans_on_the_model_for_booms_and_on_averages_for_busts():
    b = surprise.BLEND
    assert (b["w1_pos"], b["w2_pos"]) == (0.25, 0.75)     # boom: 25% averages, 75% model
    assert (b["w1_neg"], b["w2_neg"]) == (0.75, 0.25)     # bust: 75% averages, 25% model
    out = surprise.blend(pd.Series([1.0, -1.0]), pd.Series([2.0, -2.0]))
    assert list(out) == [pytest.approx(1.75), pytest.approx(-1.25)]
