"""Surprises of the night: how unexpected each player's line was.

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

The stat weights: shooting through the two impacts, threes at half weight
(October 2026); the window weights and the blend were set by the league in October 2026. They live
here on purpose: a server-side decision, not a UI control. Changing any of
them means re-training the calibration (scripts/build_surprise_calibration.py).
"""

from __future__ import annotations

import json
from datetime import date, datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.stats import norm

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


def add_efficiency(df: pd.DataFrame) -> pd.DataFrame:
    """EFF_FG / EFF_FT (makes above the league rate on the same attempts) on a
    box-score frame; returned as is when it already carries them."""
    if all(name in df.columns for name in EFFICIENCY):
        return df
    df = df.copy()
    for name, (made, att, p) in EFFICIENCY.items():
        df[name] = df[made].astype(float) - p * df[att].astype(float)
    return df


# --- Z-scores (every played game counts; windows strictly before tonight) ----

def compute_zscores(
    players_raw: pd.DataFrame,
    stats: list[str] | None = None,
    pct_stats: list[tuple[str, str, str]] | None = None,
    with_means: bool = False,
    families: tuple[str, ...] = (BASIS,),
) -> pd.DataFrame:
    """Per player-game surprise scores over played games (MIN > 0).

    Every base excludes tonight's game: *_ALL uses the expanding multi-season
    history, *_SEASON the expanding current-season history, *_L10/*_L5 the
    previous 10/5 played games (full window required). SEASON_GAMES is the
    number of prior games this season (the season window's weight follows it). Three families per
    window, addressing "bad players always win raw z" (their tiny stds explode
    the score):

      Z_    raw z              (x - mean) / std                — rarity vs his own noise
      PZ_   Pearson z          (x - mean) / sqrt(mean + 1)     — variance follows the
            mean (Poisson-like), so a scrub's collapsed std can't inflate it;
            same convention as training's Pearson residual
      QZ_   percentile probit  norm.ppf((#prior below + ties/2 + 0.5)/(n + 1))
            — distribution-free "how rare was tonight among HIS OWN games",
            bounded by sample size so small windows can't make extreme claims

    Shooting stats get a BINOMIAL z of tonight's makes against the prior make
    rate (stored identically under all three families). With ``with_means`` the
    strictly-prior SEASON and ALL means (make rates for percentages) are added
    as AVG_SEASON_<stat> / AVG_ALL_<stat>, for display next to tonight's number.

    ``families`` picks which of Z/PZ/QZ to build: the nightly job needs only the
    scoring basis (memory on a small container), the research backtest all three.
    """
    stats = list(Z_STATS if stats is None else stats)
    pct_stats = list(PCT_STATS if pct_stats is None else pct_stats)

    players_raw = add_efficiency(players_raw)
    zdf = players_raw[players_raw["MIN"].notna() & (players_raw["MIN"] > 0)]
    zdf = zdf.sort_values(["PLAYER_ID", "GAME_DATE"]).reset_index(drop=True)

    cols: dict[str, pd.Series] = {}
    pid = zdf["PLAYER_ID"]
    season_keys = [pid, zdf["SEASON"]]
    n_all = zdf.groupby("PLAYER_ID").cumcount().astype(float)          # prior games
    n_season = zdf.groupby(["PLAYER_ID", "SEASON"]).cumcount().astype(float)

    for stat in stats:
        s = zdf[stat].astype(float)
        prior = s.groupby(pid).shift(1)                 # value of the previous game
        gp = prior.groupby(pid)
        prior_season = s.groupby(season_keys).shift(1)
        gps = prior_season.groupby(season_keys)

        def z(mean: pd.Series, std: pd.Series) -> pd.Series:
            return (s - mean) / std.replace(0.0, np.nan)

        def pearson(mean: pd.Series) -> pd.Series:
            if stat in EFFICIENCY:   # an impact can be negative: the plain difference
                return s - mean
            return (s - mean) / np.sqrt(mean.clip(lower=0.0) + 1.0)

        def probit(rank_incl: pd.Series, n_prior) -> pd.Series:
            # rank of tonight within (priors + tonight), average-tie method:
            # rank - 1 == (#priors strictly below) + (#tied priors)/2
            pct = (rank_incl - 1.0 + 0.5) / (n_prior + 1.0)
            return pd.Series(norm.ppf(pct), index=s.index)

        bases = {
            "ALL": (gp.expanding().mean().droplevel(0),
                    gp.expanding().std().droplevel(0)),
            "SEASON": (gps.expanding().mean().droplevel([0, 1]),
                       gps.expanding().std().droplevel([0, 1])),
            "L10": (gp.rolling(10, min_periods=10).mean().droplevel(0),
                    gp.rolling(10, min_periods=10).std().droplevel(0)),
            "L5": (gp.rolling(5, min_periods=5).mean().droplevel(0),
                   gp.rolling(5, min_periods=5).std().droplevel(0)),
        }
        for win, (mean, std) in bases.items():
            if "Z" in families:
                cols[f"Z_{win}_{stat}"] = z(mean, std)
            if "PZ" in families:
                cols[f"PZ_{win}_{stat}"] = pearson(mean)
        if with_means:
            cols[f"AVG_SEASON_{stat}"] = bases["SEASON"][0]
            cols[f"AVG_ALL_{stat}"] = bases["ALL"][0]

        if "QZ" in families:
            # Percentile ranks: window INCLUDES tonight (rank - 1 scores vs priors).
            cols[f"QZ_ALL_{stat}"] = probit(
                s.groupby(pid).expanding(min_periods=2).rank().droplevel(0), n_all)
            cols[f"QZ_SEASON_{stat}"] = probit(
                s.groupby(season_keys).expanding(min_periods=2).rank().droplevel([0, 1]),
                n_season)
            cols[f"QZ_L10_{stat}"] = probit(
                s.groupby(pid).rolling(11, min_periods=11).rank().droplevel(0), 10.0)
            cols[f"QZ_L5_{stat}"] = probit(
                s.groupby(pid).rolling(6, min_periods=6).rank().droplevel(0), 5.0)

    # --- FG% / FT% efficiency surprise (volume-aware) -----------------------
    # BINOMIAL z-score of tonight's shooting vs his prior make rate. A raw % z is
    # junk (1/1 == "100%!"). Instead: with prior make rate p (over the window) and
    # tonight's n attempts, the makes are Binomial(n, p) — expected n·p, std
    # √(n·p(1−p)). The luck-adjusted surprise is
    #   z = (makes − n·p) / √(n·p(1−p))
    # Rewards volume (a 6/6 beats a 2/2) and penalizes cold high-volume nights,
    # while the √ denominator down-weights small-sample flukes. p is the strictly-
    # prior Σmakes/Σattempts per window (leakage-safe). NaN when n=0 or p∈{0,1}
    # (no variance to normalize by).
    for num, den, name in pct_stats:
        made, att = zdf[num].astype(float), zdf[den].astype(float)
        pn, pd_ = zdf.groupby(pid)[num].shift(1), zdf.groupby(pid)[den].shift(1)
        gpn, gpd = pn.groupby(pid), pd_.groupby(pid)
        pns, pds = zdf.groupby(season_keys)[num].shift(1), zdf.groupby(season_keys)[den].shift(1)
        gpns, gpds = pns.groupby(season_keys), pds.groupby(season_keys)

        sums = {
            "ALL": (gpn.expanding().sum().droplevel(0), gpd.expanding().sum().droplevel(0)),
            "SEASON": (gpns.expanding().sum().droplevel([0, 1]),
                       gpds.expanding().sum().droplevel([0, 1])),
            "L10": (gpn.rolling(10, min_periods=10).sum().droplevel(0),
                    gpd.rolling(10, min_periods=10).sum().droplevel(0)),
            "L5": (gpn.rolling(5, min_periods=5).sum().droplevel(0),
                   gpd.rolling(5, min_periods=5).sum().droplevel(0)),
        }
        for win, (msum, asum) in sums.items():
            p = msum / asum.replace(0.0, np.nan)               # prior make rate
            sd = np.sqrt(att * p * (1.0 - p))                  # binomial std of makes
            binom_z = (made - att * p) / sd.replace(0.0, np.nan)
            for fam in families:
                cols[f"{fam}_{win}_{name}"] = binom_z
            if with_means and win in ("SEASON", "ALL"):
                cols[f"AVG_{win}_{name}"] = p
    cols["SEASON_GAMES"] = n_season
    return pd.concat([zdf[["PLAYER_ID", "GAME_ID"]], pd.DataFrame(cols, index=zdf.index)], axis=1)


def night_zscores(
    rows: pd.DataFrame,
    night: date,
    stats: list[str] | None = None,
    pct_stats: list[tuple[str, str, str]] | None = None,
) -> pd.DataFrame:
    """``compute_zscores`` for one night only: the Pearson family plus the
    prior-window means, for the rows played on ``night``.

    The expanding/rolling version walks every row of every player's history
    to produce values that are only read at the last row. For the nightly job
    that is 13k-43k rows of work and intermediates per night. The window
    statistics at the last row are plain aggregates over the prior rows
    (all / this season / last 10 / last 5), so this computes exactly those,
    for the night's rows only: same numbers, one pass, a few hundred rows out.
    Equality with ``compute_zscores`` is pinned by test_surprise.
    """
    stats = list(Z_STATS if stats is None else stats)
    pct_stats = list(PCT_STATS if pct_stats is None else pct_stats)
    night_ts = pd.Timestamp(night)

    rows = add_efficiency(rows)
    played = rows[rows["MIN"].notna() & (rows["MIN"] > 0)]
    played = played.sort_values(["PLAYER_ID", "GAME_DATE"])
    dates = played["GAME_DATE"].dt.normalize()
    tonight = played[dates == night_ts].drop_duplicates("PLAYER_ID", keep="last").set_index("PLAYER_ID")
    prior = played[(dates < night_ts) & played["PLAYER_ID"].isin(tonight.index)]
    same_season = prior["SEASON"].to_numpy() == tonight["SEASON"].reindex(prior["PLAYER_ID"]).to_numpy()

    windows = {
        "ALL": (prior, 1),
        "SEASON": (prior[same_season], 1),
        "L10": (prior.groupby("PLAYER_ID").tail(10), 10),
        "L5": (prior.groupby("PLAYER_ID").tail(5), 5),
    }
    cols: dict[str, pd.Series] = {}
    for win, (w, need) in windows.items():
        g = w.groupby("PLAYER_ID")
        enough = g.size().reindex(tonight.index).fillna(0) >= need
        for stat in stats:
            mean = g[stat].mean().reindex(tonight.index).where(enough)
            x = tonight[stat].astype(float)
            diff = x - mean
            cols[f"PZ_{win}_{stat}"] = diff if stat in EFFICIENCY else diff / np.sqrt(mean.clip(lower=0.0) + 1.0)
            if win in ("ALL", "SEASON"):
                cols[f"AVG_{win}_{stat}"] = mean
        for num, den, name in pct_stats:
            msum = g[num].sum().reindex(tonight.index).where(enough)
            asum = g[den].sum().reindex(tonight.index).where(enough)
            p_rate = msum / asum.replace(0.0, np.nan)
            att, made = tonight[den].astype(float), tonight[num].astype(float)
            sd = np.sqrt(att * p_rate * (1.0 - p_rate))
            cols[f"PZ_{win}_{name}"] = (made - att * p_rate) / sd.replace(0.0, np.nan)
            if win in ("ALL", "SEASON"):
                cols[f"AVG_{win}_{name}"] = p_rate
    cols["SEASON_GAMES"] = (
        prior[same_season].groupby("PLAYER_ID").size().reindex(tonight.index).fillna(0).astype(float)
    )
    out = pd.DataFrame(cols, index=tonight.index)
    out.insert(0, "GAME_ID", tonight["GAME_ID"])
    return out.reset_index()


def add_errors(df: pd.DataFrame) -> pd.DataFrame:
    """ERR_<stat> = actual − predicted for the model targets and the derived
    percentages (NaN where there is no prediction)."""
    df = df.copy()
    df["FG_PCT"] = np.where(df["FGA"] > 0, df["FGM"] / df["FGA"].replace(0, np.nan), np.nan)
    df["FT_PCT"] = np.where(df["FTA"] > 0, df["FTM"] / df["FTA"].replace(0, np.nan), np.nan)
    if "PRED_FG_PCT" not in df.columns:
        df["PRED_FG_PCT"] = df["PRED_FGM"] / df["PRED_FGA"].replace(0, np.nan)
    if "PRED_FT_PCT" not in df.columns:
        df["PRED_FT_PCT"] = df["PRED_FTM"] / df["PRED_FTA"].replace(0, np.nan)
    for stat in ERR_TARGETS + ["FG_PCT", "FT_PCT"]:
        pred = df[f"PRED_{stat}"] if f"PRED_{stat}" in df.columns else np.nan
        df[f"ERR_{stat}"] = df[stat] - pred
    df = add_efficiency(df)
    for name, (made, att, p) in EFFICIENCY.items():
        df[f"PRED_{name}"] = df[f"PRED_{made}"] - p * df[f"PRED_{att}"]
        df[f"ERR_{name}"] = df[name] - df[f"PRED_{name}"]
    return df


# --- Scoring ------------------------------------------------------------------

def metric_columns() -> tuple[dict[str, float], dict[str, float]]:
    """(metric-1 column weights, metric-2 column weights) on the RAW z / error
    columns. Calibration standardizes each column before weighting."""
    m1 = {
        f"{BASIS}_{win}_{stat}": ww * sw
        for win, ww in WINDOW_WEIGHTS.items() if ww
        for stat, sw in Z_WEIGHTS.items() if sw
    }
    m2 = {f"ERR_{stat}": w for stat, w in ERR_WEIGHTS.items() if w}
    return m1, m2


def required_columns() -> list[str]:
    m1, m2 = metric_columns()
    return list(m1) + list(m2)


def standardize(df: pd.DataFrame, calibration: dict) -> pd.DataFrame:
    """NORM_<col> = (col − mean) / std with the reference season's moments."""
    out = pd.DataFrame(index=df.index)
    for col, moments in calibration["norm"].items():
        if col not in df.columns:
            continue
        std = moments["std"]
        out[f"NORM_{col}"] = (df[col] - moments["mean"]) / std if std and std > 0 else np.nan
    return out


def weighted_metric(df: pd.DataFrame, col_weights: dict[str, float]) -> pd.Series:
    """Sum(w · NORM_col) / Sum(|w|); NaN components contribute 0, rows where
    every weighted component is NaN stay NaN. Season-window columns are scaled
    per row by season_factor (their weight grows with the games behind them)."""
    factor = season_factor(df)
    total = sum(abs(w) for w in col_weights.values() if w)
    if total == 0:
        return pd.Series(np.nan, index=df.index)
    acc = pd.Series(0.0, index=df.index)
    any_valid = pd.Series(False, index=df.index)
    for col, w in col_weights.items():
        norm_col = f"NORM_{col}"
        if not w or norm_col not in df.columns:
            continue
        weight = w * factor if "_SEASON_" in col else w
        acc = acc + df[norm_col].fillna(0.0) * weight
        any_valid = any_valid | df[norm_col].notna()
    return (acc / total).where(any_valid)


def final_raw(df: pd.DataFrame) -> pd.DataFrame:
    """METRIC_Z, METRIC_ERR and the un-normalized FINAL on a frame that already
    carries the NORM_ columns and MIN."""
    m1, m2 = metric_columns()
    out = pd.DataFrame(index=df.index)
    mz = weighted_metric(df, m1)
    if VOLUME_WEIGHT:
        mz = mz * np.sqrt(df["MIN"].astype(float) / 30.0)
    me = weighted_metric(df, m2)
    out["METRIC_Z"] = mz
    out["METRIC_ERR"] = me
    out["FINAL_RAW"] = blend(mz, me)
    return out


def by_side(z, err):
    """BLEND of metric 1 (or a stat's z) and metric 2 (or its error): the
    boom-side blend where positive plus the bust-side blend where negative.
    When both sides agree that is the one side's blend; when they disagree
    they cancel toward 0. Rising in both inputs and continuous, so a better
    game never scores lower (picking one side by the sign of the other let a
    worse model error flip a 0 into +1.3). Works on Series and DataFrames."""
    b = BLEND
    fp = (b["w1_pos"] * z + b["w2_pos"] * err) / ((abs(b["w1_pos"]) + abs(b["w2_pos"])) or 1.0)
    fn = (b["w1_neg"] * z + b["w2_neg"] * err) / ((abs(b["w1_neg"]) + abs(b["w2_neg"])) or 1.0)
    return fp.clip(lower=0) + fn.clip(upper=0)


def blend(mz: pd.Series, me: pd.Series) -> pd.Series:
    """The final's raw value from metric 1 and metric 2 (by_side). NaN where
    metric 2 is (no model estimate)."""
    return by_side(mz, me)


def to_standard_normal_with(final: pd.Series, quantiles: list[float], count: int) -> pd.Series:
    q = np.asarray(quantiles, dtype=float)
    probs = np.linspace(0.0, 1.0, len(q))
    n = float(count or len(q))
    pct = np.interp(final.to_numpy(dtype=float), q, probs)
    pct = np.clip(pct, 0.5 / n, 1.0 - 0.5 / n)
    return pd.Series(norm.ppf(pct), index=final.index).where(final.notna())


def to_standard_normal(final: pd.Series, calibration: dict) -> pd.Series:
    """Rank-based inverse-normal transform against the reference season:
    Φ⁻¹(percentile of the value among the season's finals). Monotonic, so the
    ranking never changes; only the scale becomes ~N(0,1)."""
    return to_standard_normal_with(final, calibration["final_quantiles"], calibration.get("final_count", 0))


def score_frame(df: pd.DataFrame, calibration: dict) -> pd.DataFrame:
    """Score a frame of player-games that carries MIN, the raw z columns
    (compute_zscores) and the ERR_ columns (add_errors). Returns METRIC_Z,
    METRIC_ERR, FINAL_RAW and SCORE (the final on the N(0,1) scale)."""
    carry = ["MIN"] + (["SEASON_GAMES"] if "SEASON_GAMES" in df.columns else [])
    normed = pd.concat([df[carry], standardize(df, calibration)], axis=1)
    out = final_raw(normed)
    with_estimate = to_standard_normal(out["FINAL_RAW"], calibration)
    z_only = to_standard_normal_with(
        out["METRIC_Z"], calibration["z_only_quantiles"], calibration.get("z_only_count", 0)
    )
    out["HAS_ESTIMATE"] = out["METRIC_ERR"].notna()
    out["SCORE"] = with_estimate.where(out["HAS_ESTIMATE"], z_only)
    return out


def per_stat_surprise(uz: pd.DataFrame, ue: pd.DataFrame) -> pd.DataFrame:
    """The final score's blend (by_side), applied per stat: z against his own
    history and the model's error for that stat; z alone where the model has
    no estimate (NaN error)."""
    ue = ue.reindex(columns=uz.columns)
    return by_side(uz, ue.fillna(0.0)).where(ue.notna(), uz)


def stat_surprises(df: pd.DataFrame, calibration: dict) -> pd.DataFrame:
    """Per row and stat, the per-stat surprise ``reasons_for`` marks: z
    against his own windows (averaged over the windows that exist) blended
    with that stat's standardized model error (per_stat_surprise)."""
    normed = standardize(df, calibration)
    factor = season_factor(df)
    strength = {}
    for stat in Z_WEIGHTS:
        acc = pd.Series(0.0, index=df.index)
        have = pd.Series(0.0, index=df.index)
        for win, ww in WINDOW_WEIGHTS.items():
            col = f"NORM_{BASIS}_{win}_{stat}"
            if col in normed.columns:
                w = ww * factor if win == "SEASON" else ww
                acc = acc + normed[col].fillna(0.0) * w
                have = have + normed[col].notna() * w
        # Average over the windows that exist: on opening night the season
        # window is empty for everyone, and dividing by all four weights would
        # dilute every verdict by a third.
        strength[stat] = (acc / have.replace(0.0, np.nan))
    uz = pd.DataFrame(strength)
    # the model's side of each stat, standardized; NaN without an estimate
    ue = pd.DataFrame({
        stat: normed[f"NORM_ERR_{err}"] if f"NORM_ERR_{err}" in normed.columns else np.nan
        for stat, err in REASON_ERR_COLUMN.items() if stat in uz.columns
    }, index=df.index)
    return per_stat_surprise(uz, ue)


def shown_average(row: pd.Series, stat: str) -> float:
    """The average a reason shows next to tonight's value: his average this
    season once it has SEASON_AVG_MIN_GAMES games; before that, over all his
    games (a one-game season average misleads). NaN when neither exists."""
    season_games = row.get("SEASON_GAMES", SEASON_AVG_MIN_GAMES)
    for win in ("SEASON", "ALL"):
        if win == "SEASON" and not season_games >= SEASON_AVG_MIN_GAMES:
            continue
        value = row.get(f"AVG_{win}_{stat}", np.nan)
        if pd.notna(value):
            return value
    return np.nan


def reasons_for(df: pd.DataFrame, scores: pd.DataFrame, calibration: dict) -> list[list[dict]]:
    """Per row, the stats that made the night, each with its own sign.

    A stat is listed when its per-stat surprise (``per_stat_surprise``: z
    against his own windows blended with the model's error for that stat, NOT
    weighted by the metric's stat weights, so a 7-three night is a reason
    whatever FG3M's weight) is at least MIN_REASON either way: positive =
    better than his norm and the model's expectation, negative = worse. A boom
    can carry a cold stat and a bust a good one. The first entry matches the
    score's sign so the headline reads right; the rest come strongest first.
    Each entry: stat, tonight's
    value, his season (or all-time) average, z (the per-stat surprise).
    """
    u = stat_surprises(df, calibration)

    out: list[list[dict]] = []
    for idx in df.index:
        score = scores.at[idx, "SCORE"]
        if pd.isna(score):
            out.append([])
            continue
        row = u.loc[idx].dropna()
        strong = row[(row >= MIN_REASON) | (row <= -MIN_REASON_BAD)]
        ranked = strong.reindex(strong.abs().sort_values(ascending=False).index)
        lead = ranked[(ranked > 0) if score >= 0 else (ranked < 0)].head(1)
        ranked = pd.concat([lead, ranked.drop(lead.index)])
        picked = []
        for stat, c in ranked.head(N_REASONS).items():
            avg = shown_average(df.loc[idx], stat)
            value = df.at[idx, stat]
            picked.append({
                "stat": stat,
                "value": None if pd.isna(value) else round(float(value), 3 if stat.endswith("_PCT") else 1),
                "avg": None if pd.isna(avg) else round(float(avg), 3 if stat.endswith("_PCT") else 1),
                "z": round(float(c), 2),
            })
        out.append(picked)
    return out


# --- Calibration --------------------------------------------------------------

def add_season_games(df: pd.DataFrame) -> pd.DataFrame:
    """SEASON_GAMES (prior played games this season) for a frame whose z
    columns were built before the column existed (the walk-forward parquet)."""
    df = df.copy()
    played = df[df["MIN"].fillna(0) > 0].sort_values(["PLAYER_ID", "GAME_DATE"])
    df["SEASON_GAMES"] = played.groupby(["PLAYER_ID", "SEASON"]).cumcount().astype(float)
    return df


def season_factor(df: pd.DataFrame) -> pd.Series:
    """min(SEASON_GAMES, SEASON_FULL_GAMES) / SEASON_FULL_GAMES per row: how much
    of its weight the season window gets (1 where the count is unknown)."""
    if "SEASON_GAMES" not in df.columns:
        return pd.Series(1.0, index=df.index)
    return (df["SEASON_GAMES"].astype(float).clip(lower=0, upper=SEASON_FULL_GAMES) / SEASON_FULL_GAMES).fillna(1.0)


def build_calibration(df: pd.DataFrame, source: str, n_quantiles: int = 1001) -> dict:
    """Reference moments and final-metric quantiles from a season frame that
    carries MIN, the raw z columns and the ERR_ columns (the research parquet)."""
    norm_moments = {}
    for col in required_columns():
        if col not in df.columns:
            continue
        s = df[col].dropna()
        norm_moments[col] = {"mean": float(s.mean()), "std": float(s.std()), "count": int(len(s))}
    calibration = {"source": source, "norm": norm_moments}
    carry = ["MIN"] + (["SEASON_GAMES"] if "SEASON_GAMES" in df.columns else [])
    normed = pd.concat([df[carry], standardize(df, calibration)], axis=1)
    raw = final_raw(normed)
    grid = np.linspace(0, 1, n_quantiles)
    if raw["METRIC_Z"].dropna().empty:
        raise ValueError("no scorable rows: the frame carries no z-score columns")
    # Reference for players scored on their own history alone: the reference
    # season's rows that had no model estimate either. Fitted on last season,
    # scored on the next one, that kept them symmetric (3.7% / 3.7% at +-1.8
    # on 2024-25 and 2025-26); fitted on all rows they came out too narrow
    # and leaning to booms (1.7% / 1.2%).
    z_only = raw.loc[raw["METRIC_ERR"].isna(), "METRIC_Z"].dropna()
    if z_only.empty:   # every row had an estimate (tests)
        z_only = raw["METRIC_Z"].dropna()
    final = raw["FINAL_RAW"].dropna()
    if final.empty:   # a frame without any model prediction (tests, a bare season)
        final = raw["METRIC_Z"].dropna()
    calibration["final_quantiles"] = [float(v) for v in np.quantile(final, grid)]
    calibration["final_count"] = int(len(final))
    calibration["z_only_quantiles"] = [float(v) for v in np.quantile(z_only, grid)]
    calibration["z_only_count"] = int(len(z_only))
    calibration["built_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    calibration["settings"] = calibration_settings()
    return calibration


def calibration_settings() -> dict:
    """Everything the calibration was trained under: a shipped calibration
    whose settings differ from these is stale and must be rebuilt."""
    return {
        "basis": BASIS, "window_weights": WINDOW_WEIGHTS, "season_full_games": SEASON_FULL_GAMES,
        "z_weights": Z_WEIGHTS,
        "err_weights": ERR_WEIGHTS, "volume_weight": VOLUME_WEIGHT, "blend": BLEND, "blend_rule": "by_side",
        "efficiency": {name: p for name, (_, _, p) in EFFICIENCY.items()}, "efficiency_window": "difference",
    }


def load_calibration(path: Path = CALIBRATION_PATH) -> dict:
    with open(path) as f:
        return json.load(f)
