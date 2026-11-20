"""serving/surprise.py (pandas-free, used nightly by the web process) must give
exactly what research/surprise_pandas.py (the pandas original) gives."""

from datetime import date

import numpy as np
import pandas as pd
import polars as pl
import pytest

from model_stats_inference.research import surprise_pandas as ref
from model_stats_inference.serving import surprise as srv


def _history(seed: int, n_players: int = 60, n_nights: int = 120):
    rng = np.random.default_rng(seed)
    base = pd.Timestamp("2025-01-05")
    rows = []
    for d in range(n_nights):
        day = base + pd.Timedelta(days=int(d * 2.3))
        season = "2024-25" if day < pd.Timestamp("2025-06-01") else "2025-26"
        for pid in range(1000, 1000 + n_players):
            if rng.random() < 0.35:
                continue
            mins = float(rng.choice([0.0, rng.uniform(2, 42)], p=[0.05, 0.95]))
            r = {"PLAYER_ID": pid, "GAME_ID": f"g{d}_{pid % 7}", "SEASON": season,
                 "GAME_DATE": day, "MIN": round(mins, 1)}
            for s, rate in (("PTS", .5), ("REB", .2), ("AST", .12), ("FG3M", .05), ("FG3A", .14),
                            ("STL", .03), ("BLK", .02), ("FGM", .2), ("FGA", .42), ("FTM", .1), ("FTA", .13)):
                r[s] = float(max(0, round(rate * mins * (0.5 + (pid % 5) / 4) + rng.normal(0, 1.5))))
            r["FGA"] = max(r["FGA"], r["FGM"])
            r["FTA"] = max(r["FTA"], r["FTM"])
            r["FG3A"] = max(r["FG3A"], r["FG3M"])
            rows.append(r)
    return pd.DataFrame(rows)


def _to_pl(df: pd.DataFrame) -> pl.DataFrame:
    out = pl.from_dict({c: df[c].tolist() for c in df.columns})
    if "GAME_DATE" in out.columns:
        out = out.with_columns(pl.col("GAME_DATE").cast(pl.Date))
    return out


def _bits_equal(a, b, name):
    a = np.asarray(a, dtype=np.float64)
    b = np.asarray(b, dtype=np.float64)
    assert a.shape == b.shape, name
    np.testing.assert_array_equal(a.view(np.int64), b.view(np.int64), err_msg=name)


@pytest.mark.parametrize("seed", [0, 1, 2])
def test_night_scoring_bit_identical(seed):
    hist = _history(seed)
    calibration = ref.load_calibration()
    nights = sorted(hist["GAME_DATE"].dt.date.unique())
    for night in (nights[3], nights[len(nights) // 2], nights[-1]):
        rows = hist[hist["GAME_DATE"].dt.date <= night]
        zr = ref.night_zscores(rows, night)
        zs = srv.night_zscores(_to_pl(rows), night)
        assert list(zr.columns) == zs.columns
        assert zr["PLAYER_ID"].tolist() == zs["PLAYER_ID"].to_list()
        assert zr["GAME_ID"].tolist() == zs["GAME_ID"].to_list()
        for c in zr.columns[2:]:
            _bits_equal(zr[c], zs[c].to_numpy(), c)

        # the night's lines + z + model predictions for ~2/3 of them
        night_rows = rows[rows["GAME_DATE"].dt.date == night].merge(zr, on=["PLAYER_ID", "GAME_ID"], how="left")
        rng = np.random.default_rng(seed + 10)
        has = rng.random(len(night_rows)) < 0.66
        for s in ref.ERR_TARGETS:
            pred = night_rows[s].to_numpy(dtype=float) * rng.uniform(0.6, 1.4, len(night_rows))
            night_rows[f"PRED_{s}"] = np.where(has, pred, np.nan)
        er = ref.add_errors(night_rows)
        es = srv.add_errors(_to_pl(night_rows))
        for c in er.columns:
            if c.startswith(("ERR_", "PRED_", "EFF_")) or c in ("FG_PCT", "FT_PCT"):
                _bits_equal(er[c], es[c].to_numpy(), c)

        sr = ref.score_frame(er, calibration)
        ss = srv.score_frame(es, calibration)
        for c in ("METRIC_Z", "METRIC_ERR", "FINAL_RAW", "SCORE"):
            _bits_equal(sr[c], ss[c].to_numpy(), c)
        assert sr["HAS_ESTIMATE"].tolist() == ss["HAS_ESTIMATE"].to_list()

        full_r = pd.concat([er, sr], axis=1)
        full_s = pl.concat([es, ss], how="horizontal")
        assert ref.reasons_for(full_r, sr, calibration) == srv.reasons_for(full_s, ss, calibration)


# --- the serving API's own behaviour (Polars frames in, NumPy arrays out) -----

def test_serving_weighted_metric_ignores_missing_components_but_not_all_missing():
    df = pl.DataFrame({"NORM_A": [1.0, float("nan"), float("nan")], "NORM_B": [3.0, 2.0, float("nan")]})
    out = srv.weighted_metric(df, {"A": 1.0, "B": 1.0})
    assert out[0] == 2.0 and out[1] == 1.0 and np.isnan(out[2])


def test_serving_blend_never_scores_a_worse_game_higher():
    z = np.linspace(-3, 3, 61)
    for err in (-2.0, 0.0, 2.0):
        f = srv.blend(z, np.full_like(z, err))
        assert np.all(np.diff(f) >= 0)


def test_serving_score_frame_without_estimate_uses_z_only_scale():
    calibration = ref.load_calibration()
    hist = _history(4)
    night = sorted(hist["GAME_DATE"].dt.date.unique())[-1]
    rows = _to_pl(hist[hist["GAME_DATE"].dt.date <= night])
    z = srv.night_zscores(rows, night)
    lines = rows.filter(pl.col("GAME_DATE") == night).join(z, on=["PLAYER_ID", "GAME_ID"], how="left")
    lines = srv.add_errors(lines.with_columns(
        [pl.lit(float("nan")).alias(f"PRED_{s}") for s in srv.ERR_TARGETS]))
    scores = srv.score_frame(lines, calibration)
    assert not scores["HAS_ESTIMATE"].any()
    assert np.isfinite(scores["SCORE"].to_numpy()).any()
    reasons = srv.reasons_for(pl.concat([lines, scores], how="horizontal"), scores, calibration)
    assert len(reasons) == lines.height
    for row in reasons:
        assert len(row) <= srv.N_REASONS
