"""Surprises of the night: how unexpected each player's line was.

This is the web process's (pandas-free) implementation: frames are Polars,
the arithmetic is the same NumPy operations in the same order as the pandas
original in research/surprise_pandas.py (which the offline backtest and
scripts/build_surprise_calibration.py use), so the scores are bit-identical;
test_surprise_parity.py pins that.

Two ingredients per player-game, both standardized against a reference season
(``surprise_calibration.json``, built by scripts/build_surprise_calibration.py
from the walk-forward research parquet) so a night's scores are comparable
across the season rather than relative to that one night:

  Metric 1 — Z-SURPRISE, minutes-blind: Pearson z of each stat against the
             player's own history (for the two shooting impacts, EFF_FG and
             EFF_FT, the plain difference from his average): last 10 games, last 5 and this season at
             half weight (the season's growing over its first 20 games), his
             whole history only as a light anchor; weighted per stat and per
             window, then
             volume-weighted by sqrt(MIN / 30) so an 8-minute outburst counts
             less than a starter's 36-minute one.
  Metric 2 — MODEL-ERROR SURPRISE: actual minus what the model expected for
             the minutes he actually played, weighted per stat (the impacts'
             estimates come from the makes and attempts estimates). Only players
             with a model estimate (MIN_INFERENCE_GAMES) have it.
  FINAL    — good side 25% metric 1 + 75% metric 2, bad side 75% metric 1 +
             25% metric 2, mapped onto N(0,1)
             by rank against
             the reference season. The sign is the verdict: positive = good
             surprise, negative = disappointment. A player without a model
             estimate yet (early season, rookies) is scored on metric 1 alone,
             ranked among the reference season's rows that had no estimate
             either (ranked among all rows they came out too narrow and
             leaning to booms), so the first weeks of a season still have a
             page.
  BUST SIDE — the same two metrics, read the way the league reads a bad night
             (November 2026, from the league's own ranking of the 20 worst
             nights): points at 2.5 times the weight and the free-throw impact
             eased (BUST_Z_WEIGHTS), one collapse counted above a string of
             medium dips (BUST_COLLAPSE_POWER), his whole
             history at 0.5 instead of 0.1 (BUST_WINDOW_WEIGHTS), the volume
             weight capped at 30 minutes (BUST_VOLUME_CAP), and every
             column measured by how rare its value is in the reference season
             (rarity_normalize) instead of by its size, so a scoring collapse
             counts for what it is and a cold line at the stripe or a string
             of small dips no longer adds up to one. The boom side is unchanged.

The stat weights: shooting through the two impacts, threes at half weight
(October 2026); the window weights and the blend were set by the league in October 2026. They live
here on purpose: a server-side decision, not a UI control. Changing any of
them means re-training the calibration (scripts/build_surprise_calibration.py).
"""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path

import numpy as np
import polars as pl
from . import kernels
from .normal import ppf as norm_ppf  # == scipy.stats.norm.ppf, bit for bit; no SciPy in production

# --- Frozen research settings -------------------------------------------------

WINDOWS = ("ALL", "SEASON", "L10", "L5")
# Who he is now: this season and his last 10 games, last 5 at half weight
# (across seasons, so a veteran has them from opening night). His whole
# history is a light anchor only; four seasons of a career say little about tonight.
WINDOW_WEIGHTS = {"ALL": 0.1, "SEASON": 0.5, "L10": 1.0, "L5": 0.5}
# The season window's weight grows with the games behind it: a single game is
# not an average (a 3-block opener would make every later night look like a
# bust), so its weight is WINDOW_WEIGHTS["SEASON"] x min(games, SEASON_FULL_GAMES)
# / SEASON_FULL_GAMES: 0.025 after one game, 0.25 after ten, 0.5 from the 20th.
SEASON_FULL_GAMES = 20
# The season average shown beside a stat ("his average") needs this many games;
# before that the reason shows his all-time average.
SEASON_AVG_MIN_GAMES = 3
# Pearson z — variance follows the mean, so a scrub's tiny std cannot explode
# his score on any decent night (raw z over-rewards low-volume players). The
# shooting impacts (EFFICIENCY) can be negative, so their PZ_ columns hold the
# plain difference from his average instead; the calibration supplies the scale.
BASIS = "PZ"
# Shooting enters as one linear impact per kind, the fantasy category's own
# measure: makes above what a league-average shooter makes on the same
# attempts, EFF_FG = FGM - LEAGUE_FG_PCT x FGA. 0/0 is 0, each make adds 1 - p
# and each miss costs p, so the farther from the league rate and the more
# attempts, the bigger either way (8/9 beats 2/2, 0/9 sinks below 0/2), and no
# centre is forgiven. League rates of 2025-26 (sum of makes / sum of attempts
# over every played game). Linear, so the model's estimate is exact from its
# makes and attempts estimates: PRED_EFF = PRED_FGM - p x PRED_FGA.
LEAGUE_FG_PCT = 0.471
LEAGUE_FT_PCT = 0.783
EFFICIENCY = {"EFF_FG": ("FGM", "FGA", LEAGUE_FG_PCT), "EFF_FT": ("FTM", "FTA", LEAGUE_FT_PCT)}
# The same stats and weights on both metrics; shooting only through the two
# impacts (makes, attempts and percentages are not weighted on their own).
Z_WEIGHTS = {
    "PTS": 1.0, "REB": 1.0, "AST": 1.0, "STL": 1.0, "BLK": 1.0, "FG3M": 0.5,
    "EFF_FG": 0.7, "EFF_FT": 0.7,
}
ERR_WEIGHTS = dict(Z_WEIGHTS)
# The bust side of both metrics weights points 2.5 times. Measured against the
# league's ranking of the season's 20 worst nights (three ballots, 11.11.2026):
# agreement with it (NDCG@10) rose from 0.63 to 0.93 with the rest of the bust
# side below, the voters agree with each other at 0.92-0.96; 2 to 3 is a
# plateau. Dropping the shooting impacts made it worse (0.42), and so did
# lifting the volume weight (early exits of 6-8 minutes took the top); the
# free-throw impact alone is eased to 0.5 (a 4-of-8 night at the stripe held
# Brown's 16 points in the season's top ten with no vote from the league).
BUST_Z_WEIGHTS = {**Z_WEIGHTS, "PTS": 2.5, "EFF_FT": 0.5}
BUST_ERR_WEIGHTS = dict(BUST_Z_WEIGHTS)
# One collapse outweighs a string of medium dips: each rarity score is raised
# to this power (sign kept) before the weighted sum, so -3 counts 5.2 and -1.5
# counts 1.8. Lillard's 9 points, with every stat a little under his norm and
# none far under, stood 3rd of the season against one vote of three; 7th now,
# behind Booker's 3 points, Sabonis's 0 and Murray's 6, the league's own top 3.
BUST_COLLAPSE_POWER = 1.5
# A bust is also judged against who he is over the long run, not only his
# last 10: the league put Gilgeous-Alexander's 17 points 7th of the 20, the
# score had it 24th of the season, because 13 under a 30-point average is an
# ordinary dip on the league's scale of recent form. With his whole history at
# 0.5 it is 17th and all ten of the league's picks are in the season's top 17.
# Not higher: at 1.0 the score leans to busts out of sample (1.22% busts past
# -2.2 against 0.94% booms past 2.1 on 2026-27; 0.91% / 0.94% at 0.5), a
# long-run average being a stale expectation for a player whose role changed.
# His last 5 at half its weight (0.25): the same agreement with both rounds of
# ballots, and fewer busts out of sample (0.97% past -2.2 on 2026-27 against
# 1.14%; the booms' 0.94% past 2.1), a five-game window being the noisiest.
BUST_WINDOW_WEIGHTS = {**WINDOW_WEIGHTS, "ALL": 0.5, "L5": 0.25}
# The volume weight sqrt(MIN / 30) softens a bust in a short stint (an early
# exit is not a bad game) but no longer deepens one past 30 minutes: Brown's
# 16 points in 40 minutes stood 10th of the season with no vote from the
# league, 16th with the cap, and agreement with the ballots rose to 0.91.
BUST_VOLUME_CAP = 1.0
# The bust side reads each column on a rarity scale: the rank of its value in
# the reference season, as a normal score (rarity_normalize), fitted with the
# calibration. In standard deviations the columns are not comparable on the
# way down: a counting stat stops at zero (points never went below -2.6) while
# the shooting impacts run to -5, so 10% of starters' nights had a shooting
# column at -1.5 or worse against 1.8% for points. The grid is spaced evenly
# in normal scores so the tails, where busts live, keep their resolution.
RARITY_GRID = np.round(np.linspace(-4.0, 4.0, 161), 2)
VOLUME_WEIGHT = True
# Blend of (z vs his own averages, model error), by side: a boom is mostly
# "beat what the model expected for his minutes" (75% model, 25% averages); a
# bust is mostly "far under his own averages" (75% averages, 25% model), so an
# empty line sinks below a star who merely missed a high projection. The boom
# side counts only when positive and the bust side only when negative, added
# (see by_side), so a better game never scores lower. The rank to N(0,1)
# afterwards makes the two sides equally rare at the same |score|.
BLEND = {"w1_pos": 0.25, "w2_pos": 0.75, "w1_neg": 0.75, "w2_neg": 0.25}

Z_STATS = sorted(s for s in Z_WEIGHTS if not s.endswith("_PCT"))
PCT_STATS = [("FGM", "FGA", "FG_PCT"), ("FTM", "FTA", "FT_PCT")]
ERR_TARGETS = ["PTS", "REB", "AST", "FG3M", "STL", "BLK", "FGM", "FGA", "FTM", "FTA"]
# The stat columns a raw box-score frame must carry for compute_zscores.
BOX_COLUMNS = ["PLAYER_ID", "GAME_ID", "SEASON", "GAME_DATE", "MIN",
               "PTS", "REB", "AST", "FG3M", "FG3A", "STL", "BLK", "FGM", "FGA", "FTM", "FTA"]

CALIBRATION_PATH = Path(__file__).parent / "surprise_calibration.json"
# The score maps the blend onto N(0,1) with a trained transform: the rank of
# the blend among last season's blends (the walk-forward backtest, scored with
# the same math and weights), stored in the calibration. It is fitted once and
# re-trained only when the math or a weight changes (build_surprise_calibration),
# never per night. On 2025-26 it turns a skewed blend (+0.57) into a symmetric
# score: 3.6% booms / 3.6% busts at +-1.8.
# Per-stat verdicts on a row ("reasons"): every stat whose per-stat surprise is
# at least MIN_REASON either way, strongest first, at most N_REASONS. The
# per-stat surprise blends the two ingredients the final score blends, for
# that stat alone: its z against the player's own windows and its standardized
# model error (actual minus what the model expected for his minutes), with the
# same by_side blend; z alone when he has no estimate. Measured on all of
# 2025-26 (240k stat cells): the median cell is 0.6, the 90th percentile 1.5.
N_REASONS = 5
# The bad side is compressed by construction (a counting stat cannot go below
# zero): on 2025-26 the 95th percentile of the per-stat surprise is 2.5 on
# the good side and 1.4 on the bad side. The bars are therefore set per sign
# at the same rarity: 1.0 marks the top 37% of good cells, 0.7 the top 38% of
# bad cells. The page's three colour steps follow the same rarity (marks.ts).
MIN_REASON = 1.0
MIN_REASON_BAD = 0.7
# The model-error column that backs each stat's verdict. The impacts carry
# their own volume (a 1-of-1 is +0.53), so no attempts gate is needed.
REASON_ERR_COLUMN = {
    "PTS": "PTS", "REB": "REB", "AST": "AST", "STL": "STL", "BLK": "BLK", "FG3M": "FG3M",
    "EFF_FG": "EFF_FG", "EFF_FT": "EFF_FT",
}




# --- column helpers (pandas semantics on NumPy arrays) ---------------------------

def _f(df: pl.DataFrame, col: str) -> np.ndarray:
    """A column as float64 with nulls as NaN (what pandas' astype(float) gives)."""
    s = df.get_column(col)
    if s.dtype == pl.Boolean:
        s = s.cast(pl.Float64)
    return s.cast(pl.Float64).fill_null(float("nan")).to_numpy().astype(np.float64, copy=False)


def _clip_lower(x, lower: float):
    """Series.clip(lower=...): values >= lower (and NaN) kept, the rest -> lower."""
    return np.where(np.isnan(x) | (x >= lower), x, lower)


def _clip_upper(x, upper: float):
    return np.where(np.isnan(x) | (x <= upper), x, upper)


def _nan_if_zero(x):
    """Series.replace(0.0, np.nan)."""
    return np.where(x == 0.0, np.nan, x)


def _with(df: pl.DataFrame, cols: dict[str, np.ndarray]) -> pl.DataFrame:
    return df.with_columns([pl.Series(k, np.asarray(v, dtype=np.float64), dtype=pl.Float64)
                            for k, v in cols.items()])


def _frame(cols: dict[str, np.ndarray], height: int) -> pl.DataFrame:
    return pl.DataFrame({k: pl.Series(k, np.asarray(v, dtype=np.float64), dtype=pl.Float64)
                         for k, v in cols.items()}, height=height)


def add_efficiency(df: pl.DataFrame) -> pl.DataFrame:
    """EFF_FG / EFF_FT (makes above the league rate on the same attempts) on a
    box-score frame; returned as is when it already carries them."""
    if all(name in df.columns for name in EFFICIENCY):
        return df
    return _with(df, {name: _f(df, made) - p * _f(df, att) for name, (made, att, p) in EFFICIENCY.items()})


# --- Z-scores of one night ------------------------------------------------------

def _dates(df: pl.DataFrame) -> pl.Series:
    s = df.get_column("GAME_DATE")
    return s.cast(pl.Date) if s.dtype != pl.Date else s


def night_zscores(
    rows: pl.DataFrame,
    night: date,
    stats: list[str] | None = None,
    pct_stats: list[tuple[str, str, str]] | None = None,
) -> pl.DataFrame:
    """The Pearson z family plus the prior-window means, for the rows played on
    ``night``: per player, aggregates over his prior rows (all / this season /
    last 10 / last 5). Columns: PLAYER_ID, GAME_ID, then the score columns, in
    the order research/surprise_pandas.night_zscores builds them; means and
    sums are pandas' Kahan-compensated group kernels (kernels.group_mean/sum)."""
    stats = list(Z_STATS if stats is None else stats)
    pct_stats = list(PCT_STATS if pct_stats is None else pct_stats)

    rows = add_efficiency(rows)
    mins = _f(rows, "MIN")
    played = rows.filter(pl.Series(~np.isnan(mins) & (mins > 0)))
    played = played.sort(["PLAYER_ID", "GAME_DATE"], maintain_order=True)
    dates = _dates(played)
    on_night = (dates == night).to_numpy()
    tonight = (played.filter(pl.Series(on_night))
               .unique(subset=["PLAYER_ID"], keep="last", maintain_order=True))
    t_ids = tonight.get_column("PLAYER_ID").to_numpy()
    pids = played.get_column("PLAYER_ID").to_numpy()
    prior_mask = (dates < night).to_numpy() & np.isin(pids, t_ids)
    prior = played.filter(pl.Series(prior_mask))
    p_ids = prior.get_column("PLAYER_ID").to_numpy()
    pos_of = {int(p): i for i, p in enumerate(t_ids)}
    t_season = tonight.get_column("SEASON").to_list()
    p_season = prior.get_column("SEASON").to_list()
    same_season = np.array([s == t_season[pos_of[int(p)]] for p, s in zip(p_ids, p_season)], dtype=bool)

    def tail_mask(ids: np.ndarray, k: int) -> np.ndarray:
        # groupby(PLAYER_ID).tail(k) on rows already grouped contiguously
        n = len(ids)
        if n == 0:
            return np.zeros(0, dtype=bool)
        starts, ends = kernels.segments_from_sorted_keys(ids)
        lengths = ends - starts
        rank_from_end = np.repeat(ends, lengths) - np.arange(n)
        return rank_from_end <= k

    windows = {
        "ALL": (np.ones(len(prior), dtype=bool), 1),
        "SEASON": (same_season, 1),
        "L10": (tail_mask(p_ids, 10), 10),
        "L5": (tail_mask(p_ids, 5), 5),
    }

    def per_tonight(uniq: np.ndarray, vals: np.ndarray) -> np.ndarray:
        out = np.full(len(t_ids), np.nan)
        for k, v in zip(uniq, vals):
            out[pos_of[int(k)]] = v
        return out

    cols: dict[str, np.ndarray] = {}
    for win, (mask, need) in windows.items():
        w_ids = p_ids[mask]
        uniq, counts = np.unique(w_ids, return_counts=True)
        size = per_tonight(uniq, counts.astype(float))
        enough = np.where(np.isnan(size), 0.0, size) >= need
        for stat in stats:
            u, means = kernels.group_mean(_f(prior, stat)[mask], w_ids)
            mean = np.where(enough, per_tonight(u, means), np.nan)
            x = _f(tonight, stat)
            diff = x - mean
            cols[f"PZ_{win}_{stat}"] = diff if stat in EFFICIENCY else diff / np.sqrt(_clip_lower(mean, 0.0) + 1.0)
            if win in ("ALL", "SEASON"):
                cols[f"AVG_{win}_{stat}"] = mean
        for num, den, name in pct_stats:
            u, ms = kernels.group_sum(_f(prior, num)[mask], w_ids)
            msum = np.where(enough, per_tonight(u, ms), np.nan)
            u, as_ = kernels.group_sum(_f(prior, den)[mask], w_ids)
            asum = np.where(enough, per_tonight(u, as_), np.nan)
            with np.errstate(divide="ignore", invalid="ignore"):
                p_rate = msum / _nan_if_zero(asum)
                att, made = _f(tonight, den), _f(tonight, num)
                sd = np.sqrt(att * p_rate * (1.0 - p_rate))
                cols[f"PZ_{win}_{name}"] = (made - att * p_rate) / _nan_if_zero(sd)
            if win in ("ALL", "SEASON"):
                cols[f"AVG_{win}_{name}"] = p_rate
    uniq, counts = np.unique(p_ids[same_season], return_counts=True)
    sg = per_tonight(uniq, counts.astype(float))
    cols["SEASON_GAMES"] = np.where(np.isnan(sg), 0.0, sg)
    return pl.concat([tonight.select("PLAYER_ID", "GAME_ID"), _frame(cols, len(t_ids))], how="horizontal")


def add_errors(df: pl.DataFrame) -> pl.DataFrame:
    """ERR_<stat> = actual − predicted for the model targets and the derived
    percentages (NaN where there is no prediction)."""
    new: dict[str, np.ndarray] = {}
    get = lambda c: new[c] if c in new else _f(df, c)  # noqa: E731
    with np.errstate(divide="ignore", invalid="ignore"):
        new["FG_PCT"] = np.where(get("FGA") > 0, get("FGM") / _nan_if_zero(get("FGA")), np.nan)
        new["FT_PCT"] = np.where(get("FTA") > 0, get("FTM") / _nan_if_zero(get("FTA")), np.nan)
        if "PRED_FG_PCT" not in df.columns:
            new["PRED_FG_PCT"] = get("PRED_FGM") / _nan_if_zero(get("PRED_FGA"))
        if "PRED_FT_PCT" not in df.columns:
            new["PRED_FT_PCT"] = get("PRED_FTM") / _nan_if_zero(get("PRED_FTA"))
        for stat in ERR_TARGETS + ["FG_PCT", "FT_PCT"]:
            has_pred = f"PRED_{stat}" in df.columns or f"PRED_{stat}" in new
            pred = get(f"PRED_{stat}") if has_pred else np.nan
            new[f"ERR_{stat}"] = get(stat) - pred
    df = _with(df, new)
    df = add_efficiency(df)
    eff: dict[str, np.ndarray] = {}
    for name, (made, att, p) in EFFICIENCY.items():
        eff[f"PRED_{name}"] = _f(df, f"PRED_{made}") - p * _f(df, f"PRED_{att}")
        eff[f"ERR_{name}"] = _f(df, name) - eff[f"PRED_{name}"]
    return _with(df, eff)


# --- Scoring ------------------------------------------------------------------

def metric_columns(bust: bool = False) -> tuple[dict[str, float], dict[str, float]]:
    """(metric-1 column weights, metric-2 column weights) on the RAW z / error
    columns, for the boom side or the bust side. Calibration normalizes each
    column before weighting."""
    z_weights, err_weights = (BUST_Z_WEIGHTS, BUST_ERR_WEIGHTS) if bust else (Z_WEIGHTS, ERR_WEIGHTS)
    m1 = {
        f"{BASIS}_{win}_{stat}": ww * sw
        for win, ww in (BUST_WINDOW_WEIGHTS if bust else WINDOW_WEIGHTS).items() if ww
        for stat, sw in z_weights.items() if sw
    }
    m2 = {f"ERR_{stat}": w for stat, w in err_weights.items() if w}
    return m1, m2


def required_columns() -> list[str]:
    """Every raw column either side weights."""
    cols: dict[str, None] = {}
    for bust in (False, True):
        for part in metric_columns(bust):
            cols.update(dict.fromkeys(part))
    return list(cols)


def _standardize(df: pl.DataFrame, calibration: dict) -> dict[str, np.ndarray]:
    out: dict[str, np.ndarray] = {}
    n = df.height
    for col, moments in calibration["norm"].items():
        if col not in df.columns:
            continue
        std = moments["std"]
        out[f"NORM_{col}"] = (_f(df, col) - moments["mean"]) / std if std and std > 0 else np.full(n, np.nan)
    return out


def standardize(df: pl.DataFrame, calibration: dict) -> pl.DataFrame:
    """NORM_<col> = (col − mean) / std with the reference season's moments."""
    return _frame(_standardize(df, calibration), df.height)


def rarity_scores(values: np.ndarray, quantiles: list[float]) -> np.ndarray:
    """Normal score of each value by its rank in the reference season:
    ``quantiles`` are the season's values at the normal scores RARITY_GRID. A
    value the season repeats (a tie over several grid points) gets the middle
    of its stretch. Rising, and bounded by the grid's ends. NaN stays NaN."""
    q = np.asarray(quantiles, dtype=float)
    v = np.asarray(values, dtype=float)
    lo = np.searchsorted(q, v, side="left")
    hi = np.searchsorted(q, v, side="right")
    last = len(q) - 1
    left = np.clip(lo - 1, 0, last)
    right = np.clip(lo, 0, last)
    span = q[right] - q[left]
    frac = np.divide(v - q[left], span, out=np.zeros_like(v), where=span > 0)
    between = RARITY_GRID[left] + frac * (RARITY_GRID[right] - RARITY_GRID[left])
    tied = (RARITY_GRID[np.clip(lo, 0, last)] + RARITY_GRID[np.clip(hi - 1, 0, last)]) / 2.0
    out = np.where(hi > lo, tied, between)
    return np.where(np.isnan(v), np.nan, out)


def _rarity_normalize(df: pl.DataFrame, calibration: dict) -> dict[str, np.ndarray]:
    return {f"RARE_{col}": rarity_scores(_f(df, col), quantiles)
            for col, quantiles in calibration.get("rarity", {}).items() if col in df.columns}


def rarity_normalize(df: pl.DataFrame, calibration: dict) -> pl.DataFrame:
    """RARE_<col> = the column's value as a normal score of its rank in the
    reference season (the bust side's scale)."""
    return _frame(_rarity_normalize(df, calibration), df.height)


def _season_factor(cols: dict[str, np.ndarray], n: int):
    if "SEASON_GAMES" not in cols:
        return np.ones(n)
    f = _clip_upper(_clip_lower(cols["SEASON_GAMES"], 0), SEASON_FULL_GAMES) / SEASON_FULL_GAMES
    return np.where(np.isnan(f), 1.0, f)


def season_factor(df: pl.DataFrame) -> np.ndarray:
    """min(SEASON_GAMES, SEASON_FULL_GAMES) / SEASON_FULL_GAMES per row: how much
    of its weight the season window gets (1 where the count is unknown)."""
    cols = {"SEASON_GAMES": _f(df, "SEASON_GAMES")} if "SEASON_GAMES" in df.columns else {}
    return _season_factor(cols, df.height)


def _weighted_metric(cols: dict[str, np.ndarray], n: int, col_weights: dict[str, float],
                     prefix: str = "NORM_") -> np.ndarray:
    factor = _season_factor(cols, n)
    total = sum(abs(w) for w in col_weights.values() if w)
    if total == 0:
        return np.full(n, np.nan)
    acc = np.zeros(n)
    any_valid = np.zeros(n, dtype=bool)
    for col, w in col_weights.items():
        norm_col = f"{prefix}{col}"
        if not w or norm_col not in cols:
            continue
        weight = w * factor if "_SEASON_" in col else w
        x = cols[norm_col]
        acc = acc + np.where(np.isnan(x), 0.0, x) * weight
        any_valid = any_valid | ~np.isnan(x)
    return np.where(any_valid, acc / total, np.nan)


def weighted_metric(df: pl.DataFrame, col_weights: dict[str, float], prefix: str = "NORM_") -> np.ndarray:
    """Sum(w · NORM_col) / Sum(|w|); NaN components contribute 0, rows where
    every weighted component is NaN stay NaN. Season-window columns are scaled
    per row by season_factor (their weight grows with the games behind them).
    ``prefix`` picks the scale: NORM_ (standardized) or RARE_ (rarity)."""
    cols = {c: _f(df, c) for c in df.columns if c.startswith(prefix) or c == "SEASON_GAMES"}
    return _weighted_metric(cols, df.height, col_weights, prefix)


def _final_raw(cols: dict[str, np.ndarray], n: int) -> dict[str, np.ndarray]:
    volume = np.sqrt(cols["MIN"] / 30.0) if VOLUME_WEIGHT else 1.0
    boom1, boom2 = metric_columns()
    bust1, bust2 = metric_columns(bust=True)
    bust_volume = _clip_upper(volume, BUST_VOLUME_CAP) if VOLUME_WEIGHT else 1.0
    cols = dict(cols)
    for c in [c for c in cols if c.startswith("RARE_")]:
        x = cols[c]
        cols[c] = np.sign(x) * np.abs(x) ** BUST_COLLAPSE_POWER
    mz = _weighted_metric(cols, n, boom1) * volume
    mz_bust = _weighted_metric(cols, n, bust1, "RARE_") * bust_volume
    me, me_bust = _weighted_metric(cols, n, boom2), _weighted_metric(cols, n, bust2, "RARE_")
    return {
        "METRIC_Z": _clip_lower(mz, 0) + _clip_upper(mz_bust, 0),
        "METRIC_ERR": _clip_lower(me, 0) + _clip_upper(me_bust, 0),
        "FINAL_RAW": blend(mz, me, mz_bust, me_bust),
    }


def final_raw(df: pl.DataFrame) -> pl.DataFrame:
    """METRIC_Z, METRIC_ERR and the un-normalized FINAL on a frame that already
    carries the NORM_ columns (boom side), the RARE_ columns (bust side) and
    MIN. Each metric is built twice, with the boom side's weights and scale
    and with the bust side's; the stored METRIC_Z / METRIC_ERR are the boom
    reading where positive plus the bust reading where negative."""
    cols = {c: _f(df, c) for c in df.columns}
    return _frame(_final_raw(cols, df.height), df.height)


def by_side(z, err, z_bust=None, err_bust=None):
    """BLEND of metric 1 (or a stat's z) and metric 2 (or its error): the
    boom-side blend where positive plus the bust-side blend where negative.
    When both sides agree that is the one side's blend; when they disagree
    they cancel toward 0. Rising in both inputs and continuous, so a better
    game never scores lower. ``z_bust`` / ``err_bust`` are the bust side's own
    reading of the two metrics; the same inputs when not given. NumPy arrays."""
    b = BLEND
    z_bust = z if z_bust is None else z_bust
    err_bust = err if err_bust is None else err_bust
    fp = (b["w1_pos"] * z + b["w2_pos"] * err) / ((abs(b["w1_pos"]) + abs(b["w2_pos"])) or 1.0)
    fn = (b["w1_neg"] * z_bust + b["w2_neg"] * err_bust) / ((abs(b["w1_neg"]) + abs(b["w2_neg"])) or 1.0)
    return _clip_lower(fp, 0) + _clip_upper(fn, 0)


def blend(mz, me, mz_bust=None, me_bust=None):
    """The final's raw value from metric 1 and metric 2 (by_side). NaN where
    metric 2 is (no model estimate)."""
    return by_side(mz, me, mz_bust, me_bust)


def to_standard_normal_with(final: np.ndarray, quantiles: list[float], count: int) -> np.ndarray:
    q = np.asarray(quantiles, dtype=float)
    probs = np.linspace(0.0, 1.0, len(q))
    n = float(count or len(q))
    final = np.asarray(final, dtype=float)
    pct = np.interp(final, q, probs)
    pct = np.clip(pct, 0.5 / n, 1.0 - 0.5 / n)
    return np.where(np.isnan(final), np.nan, norm_ppf(pct))


def to_standard_normal(final: np.ndarray, calibration: dict) -> np.ndarray:
    """Rank-based inverse-normal transform against the reference season:
    Φ⁻¹(percentile of the value among the season's finals). Monotonic, so the
    ranking never changes; only the scale becomes ~N(0,1)."""
    return to_standard_normal_with(final, calibration["final_quantiles"], calibration.get("final_count", 0))


def score_frame(df: pl.DataFrame, calibration: dict) -> pl.DataFrame:
    """Score a frame of player-games that carries MIN, the raw z columns and
    the ERR_ columns (add_errors). Returns METRIC_Z, METRIC_ERR, FINAL_RAW,
    HAS_ESTIMATE and SCORE (the final on the N(0,1) scale)."""
    n = df.height
    carry = ["MIN"] + (["SEASON_GAMES"] if "SEASON_GAMES" in df.columns else [])
    cols = {c: _f(df, c) for c in carry}
    cols.update(_standardize(df, calibration))
    cols.update(_rarity_normalize(df, calibration))
    out = _final_raw(cols, n)
    with_estimate = to_standard_normal(out["FINAL_RAW"], calibration)
    z_only = to_standard_normal_with(
        out["METRIC_Z"], calibration["z_only_quantiles"], calibration.get("z_only_count", 0))
    has = ~np.isnan(out["METRIC_ERR"])
    return pl.DataFrame({
        "METRIC_Z": out["METRIC_Z"], "METRIC_ERR": out["METRIC_ERR"], "FINAL_RAW": out["FINAL_RAW"],
        "HAS_ESTIMATE": pl.Series("HAS_ESTIMATE", has, dtype=pl.Boolean),
        "SCORE": np.where(has, with_estimate, z_only),
    }, height=n)


def per_stat_surprise(uz: np.ndarray, ue: np.ndarray) -> np.ndarray:
    """The final score's blend (by_side), applied per stat: z against his own
    history and the model's error for that stat; z alone where the model has
    no estimate (NaN error). (rows, stats) arrays."""
    return np.where(np.isnan(ue), uz, by_side(uz, np.where(np.isnan(ue), 0.0, ue)))


def stat_surprises(df: pl.DataFrame, calibration: dict) -> tuple[list[str], np.ndarray]:
    """Per row and stat, the per-stat surprise ``reasons_for`` marks: z
    against his own windows (averaged over the windows that exist) blended
    with that stat's standardized model error (per_stat_surprise).
    Returns (stats, (rows, stats) array)."""
    n = df.height
    normed = _standardize(df, calibration)
    factor = season_factor(df)
    stats, strength = [], []
    for stat in Z_WEIGHTS:
        acc = np.zeros(n)
        have = np.zeros(n)
        for win, ww in WINDOW_WEIGHTS.items():
            col = f"NORM_{BASIS}_{win}_{stat}"
            if col in normed:
                w = ww * factor if win == "SEASON" else ww
                x = normed[col]
                acc = acc + np.where(np.isnan(x), 0.0, x) * w
                have = have + (~np.isnan(x)) * w
        with np.errstate(divide="ignore", invalid="ignore"):
            strength.append(acc / _nan_if_zero(have))
        stats.append(stat)
    uz = np.column_stack(strength) if strength else np.zeros((n, 0))
    ue = np.column_stack([
        normed[f"NORM_ERR_{REASON_ERR_COLUMN[s]}"] if s in REASON_ERR_COLUMN and f"NORM_ERR_{REASON_ERR_COLUMN[s]}" in normed
        else np.full(n, np.nan)
        for s in stats
    ]) if stats else np.zeros((n, 0))
    return stats, per_stat_surprise(uz, ue)


def shown_average(row: dict, stat: str) -> float:
    """The average a reason shows next to tonight's value: his average this
    season once it has SEASON_AVG_MIN_GAMES games; before that, over all his
    games (a one-game season average misleads). NaN when neither exists."""
    season_games = row.get("SEASON_GAMES", SEASON_AVG_MIN_GAMES)
    if season_games is None:
        season_games = float("nan")
    for win in ("SEASON", "ALL"):
        if win == "SEASON" and not season_games >= SEASON_AVG_MIN_GAMES:
            continue
        value = row.get(f"AVG_{win}_{stat}", np.nan)
        if value is not None and not (isinstance(value, float) and np.isnan(value)):
            return value
    return np.nan


def _nargsort_desc(values: np.ndarray) -> np.ndarray:
    """pandas.core.sorting.nargsort(ascending=False) on NaN-free values: the
    order Series.sort_values(ascending=False) picks, ties included."""
    idx = np.arange(len(values))
    rev_vals = values[::-1]
    rev_idx = idx[::-1]
    indexer = rev_idx[rev_vals.argsort(kind="quicksort")]
    return indexer[::-1]


def reasons_for(df: pl.DataFrame, scores: pl.DataFrame, calibration: dict) -> list[list[dict]]:
    """Per row, the stats that made the night, each with its own sign.

    A stat is listed when its per-stat surprise (``per_stat_surprise``) is at
    least MIN_REASON either way: positive = better than his norm and the
    model's expectation, negative = worse. The first entry matches the score's
    sign so the headline reads right; the rest come strongest first. Each
    entry: stat, tonight's value, his season (or all-time) average, z.
    """
    stats, u = stat_surprises(df, calibration)
    score_col = _f(scores, "SCORE")
    rows = df.to_dicts()
    out: list[list[dict]] = []
    for i, row_vals in enumerate(rows):
        score = score_col[i]
        if np.isnan(score):
            out.append([])
            continue
        vals = u[i]
        keep = [j for j in range(len(stats)) if not np.isnan(vals[j])]
        strong = [j for j in keep if vals[j] >= MIN_REASON or vals[j] <= -MIN_REASON_BAD]
        sv = np.array([vals[j] for j in strong], dtype=float)
        ranked = [strong[k] for k in _nargsort_desc(np.abs(sv))] if strong else []
        lead = [j for j in ranked if (vals[j] > 0 if score >= 0 else vals[j] < 0)][:1]
        ranked = lead + [j for j in ranked if j not in lead]
        picked = []
        for j in ranked[:N_REASONS]:
            stat = stats[j]
            avg = shown_average(row_vals, stat)
            value = row_vals.get(stat)
            nd = 3 if stat.endswith("_PCT") else 1
            picked.append({
                "stat": stat,
                "value": None if value is None or (isinstance(value, float) and np.isnan(value)) else round(float(value), nd),
                "avg": None if avg is None or (isinstance(avg, float) and np.isnan(avg)) else round(float(avg), nd),
                "z": round(float(vals[j]), 2),
            })
        out.append(picked)
    return out


# --- Calibration --------------------------------------------------------------

def calibration_settings() -> dict:
    """Everything the calibration was trained under: a shipped calibration
    whose settings differ from these is stale and must be rebuilt."""
    return {
        "basis": BASIS, "window_weights": WINDOW_WEIGHTS, "season_full_games": SEASON_FULL_GAMES,
        "z_weights": Z_WEIGHTS,
        "err_weights": ERR_WEIGHTS, "volume_weight": VOLUME_WEIGHT, "blend": BLEND, "blend_rule": "by_side",
        "bust_z_weights": BUST_Z_WEIGHTS, "bust_err_weights": BUST_ERR_WEIGHTS,
        "bust_window_weights": BUST_WINDOW_WEIGHTS, "bust_volume_cap": BUST_VOLUME_CAP,
        "bust_collapse_power": BUST_COLLAPSE_POWER,
        "bust_scale": "rarity", "rarity_grid": [float(RARITY_GRID[0]), float(RARITY_GRID[-1]), len(RARITY_GRID)],
        "efficiency": {name: p for name, (_, _, p) in EFFICIENCY.items()}, "efficiency_window": "difference",
    }


def load_calibration(path: Path = CALIBRATION_PATH) -> dict:
    with open(path) as f:
        return json.load(f)
