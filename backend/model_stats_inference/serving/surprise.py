"""Surprises of the night: how unexpected each player's line was.

Two ingredients per player-game, both standardized against a reference season
(``surprise_calibration.json``, built by scripts/build_surprise_calibration.py
from the walk-forward research parquet) so a night's scores are comparable
across the season rather than relative to that one night:

  Metric 1 — Z-SURPRISE, minutes-blind: Pearson z of each stat against the
             player's own history over four windows (all data / this season /
             last 10 / last 5), weighted per stat and per window, then
             volume-weighted by sqrt(MIN / 30) so an 8-minute outburst counts
             less than a starter's 36-minute one.
  Metric 2 — MODEL-ERROR SURPRISE: actual minus what the model expected for
             the minutes he actually played, weighted per stat. Only players
             with a model estimate (MIN_INFERENCE_GAMES) have it.
  FINAL    — a blend that differs by sign (model error adds on the good side,
             z dominates on the bad side), mapped onto N(0,1) by rank against
             the reference season. The sign is the verdict: positive = good
             surprise, negative = disappointment. A player without a model
             estimate yet (early season, rookies) is scored on metric 1 alone,
             against its own reference distribution, so the first weeks of a
             season still have a page.

The weights are the research dashboard's final defaults (July 2026) and live
here on purpose: they are a server-side decision, not a UI control.
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
# Lean on recent form: all-data is the weakest "who is he" anchor.
WINDOW_WEIGHTS = {"ALL": 0.5, "SEASON": 1.0, "L10": 1.0, "L5": 0.5}
# Pearson z — variance follows the mean, so a scrub's tiny std cannot explode
# his score on any decent night (raw z over-rewards low-volume players).
BASIS = "PZ"
# Make-volume plus binomial shooting efficiency: a monster scoring line rises
# from the weights themselves, a cold 0/9 sinks. Zero-weight stats are omitted.
Z_WEIGHTS = {
    "PTS": 1.0, "FGM": 0.5, "FTM": 0.5, "REB": 1.0, "AST": 1.0,
    "STL": 1.0, "BLK": 1.0, "FG_PCT": 0.50, "FG3M": 0.40, "FT_PCT": 0.35,
}
# Model error: scoring/makes-dominant like metric 1; attempts stay slightly
# negative (efficiency) but small, so a huge-volume night isn't buried.
ERR_WEIGHTS = {
    "PTS": 1.0, "FGM": 0.5, "FTM": 0.5, "REB": 1.0, "AST": 1.0,
    "STL": 1.0, "BLK": 1.0, "FG3M": 0.65, "FG_PCT": 0.20, "FT_PCT": 0.20,
    "FGA": -0.10, "FTA": -0.10,
}
VOLUME_WEIGHT = True
# Piecewise blend of (z, model-error): positive side lets the model error add
# value; negative side the z-surprise dominates so 0-fers sink below stars who
# merely underperformed the model's high bar.
BLEND = {"w1_pos": 0.49, "w2_pos": 1.20, "w1_neg": 1.10, "w2_neg": 0.20}

Z_STATS = sorted(s for s in Z_WEIGHTS if not s.endswith("_PCT"))
PCT_STATS = [("FGM", "FGA", "FG_PCT"), ("FTM", "FTA", "FT_PCT")]
ERR_TARGETS = ["PTS", "REB", "AST", "FG3M", "STL", "BLK", "FGM", "FGA", "FTM", "FTA"]
# The stat columns a raw box-score frame must carry for compute_zscores.
BOX_COLUMNS = ["PLAYER_ID", "GAME_ID", "SEASON", "GAME_DATE", "MIN",
               "PTS", "REB", "AST", "FG3M", "FG3A", "STL", "BLK", "FGM", "FGA", "FTM", "FTA"]

CALIBRATION_PATH = Path(__file__).parent / "surprise_calibration.json"
# Per-stat verdicts on a row ("reasons"): every stat whose per-stat surprise is
# at least MIN_REASON either way, strongest first, at most N_REASONS. The
# per-stat surprise blends the two ingredients the final score blends, for
# that stat alone: its z against the player's own windows and its standardized
# model error (actual minus what the model expected for his minutes), with the
# same sign-piecewise weights; z alone when he has no estimate. Measured on
# two real nights: the median cell is 0.6, the 90th percentile 1.8; at 1.0 a
# flagged row carries about five marks and one in seven carries both colours.
N_REASONS = 5
MIN_REASON = 1.0
# The model-error column that backs each stat's verdict. Shooting uses the
# makes error (volume-inherent), never the percentage error.
REASON_ERR_COLUMN = {
    "PTS": "PTS", "REB": "REB", "AST": "AST", "STL": "STL", "BLK": "BLK", "FG3M": "FG3M",
    "FGM": "FGM", "FTM": "FTM", "FG_PCT": "FGM", "FT_PCT": "FTM",
}
# A shooting verdict needs volume: the binomial z of a 1-of-1 night is ~1 on
# its own, so FG needs this many attempts and FT this many to be marked.
MIN_FGA_FOR_REASON = 4
MIN_FTA_FOR_REASON = 3


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
    previous 10/5 played games (full window required). Three families per
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
            cols[f"PZ_{win}_{stat}"] = (x - mean) / np.sqrt(mean.clip(lower=0.0) + 1.0)
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
    every weighted component is NaN stay NaN."""
    total = sum(abs(w) for w in col_weights.values() if w)
    if total == 0:
        return pd.Series(np.nan, index=df.index)
    acc = pd.Series(0.0, index=df.index)
    any_valid = pd.Series(False, index=df.index)
    for col, w in col_weights.items():
        norm_col = f"NORM_{col}"
        if not w or norm_col not in df.columns:
            continue
        acc = acc + df[norm_col].fillna(0.0) * w
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
    b = BLEND
    fp = (b["w1_pos"] * mz + b["w2_pos"] * me) / ((abs(b["w1_pos"]) + abs(b["w2_pos"])) or 1.0)
    fn = (b["w1_neg"] * mz + b["w2_neg"] * me) / ((abs(b["w1_neg"]) + abs(b["w2_neg"])) or 1.0)
    out["METRIC_Z"] = mz
    out["METRIC_ERR"] = me
    out["FINAL_RAW"] = fp.where(fp >= 0, fn)
    return out


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
    normed = pd.concat([df[["MIN"]], standardize(df, calibration)], axis=1)
    out = final_raw(normed)
    with_estimate = to_standard_normal(out["FINAL_RAW"], calibration)
    z_only = to_standard_normal_with(
        out["METRIC_Z"], calibration["z_only_quantiles"], calibration.get("z_only_count", 0)
    )
    out["HAS_ESTIMATE"] = out["METRIC_ERR"].notna()
    out["SCORE"] = with_estimate.where(out["HAS_ESTIMATE"], z_only)
    return out


def per_stat_surprise(uz: pd.DataFrame, ue: pd.DataFrame) -> pd.DataFrame:
    """The final score's blend, applied per stat: z against his own history
    and the model's error for that stat, positive-side weights when the
    blend is positive, negative-side when not; z alone where the model has
    no estimate (NaN error)."""
    b = BLEND
    ue = ue.reindex(columns=uz.columns)
    has_err = ue.notna()
    fp = (b["w1_pos"] * uz + b["w2_pos"] * ue.fillna(0.0)) / (abs(b["w1_pos"]) + abs(b["w2_pos"]))
    fn = (b["w1_neg"] * uz + b["w2_neg"] * ue.fillna(0.0)) / (abs(b["w1_neg"]) + abs(b["w2_neg"]))
    blended = fp.where(fp >= 0, fn)
    return blended.where(has_err, uz)


def reasons_for(df: pd.DataFrame, scores: pd.DataFrame, calibration: dict) -> list[list[dict]]:
    """Per row, the stats that made the night, each with its own sign.

    A stat is listed when its per-stat surprise (``per_stat_surprise``: z
    against his own windows blended with the model's error for that stat, NOT
    weighted by the metric's stat weights, so a 7-three night is a reason
    whatever FG3M's weight) is at least MIN_REASON either way: positive =
    better than his norm and the model's expectation, negative = worse. A boom
    can carry a cold stat and a bust a good one. The first entry matches the
    score's sign so the headline reads right; the rest come strongest first.
    Shooting stats also need the volume gates. Each entry: stat, tonight's
    value, his season (or all-time) average, z (the per-stat surprise).
    """
    normed = standardize(df, calibration)
    total_ww = sum(WINDOW_WEIGHTS.values())
    strength = {}
    for stat in Z_WEIGHTS:
        acc = pd.Series(0.0, index=df.index)
        have = pd.Series(0.0, index=df.index)
        for win, ww in WINDOW_WEIGHTS.items():
            col = f"NORM_{BASIS}_{win}_{stat}"
            if col in normed.columns:
                acc = acc + normed[col].fillna(0.0) * ww
                have = have + normed[col].notna() * ww
        strength[stat] = (acc / total_ww).where(have > 0)
    uz = pd.DataFrame(strength)
    # the model's side of each stat, standardized; NaN without an estimate
    ue = pd.DataFrame({
        stat: normed[f"NORM_ERR_{err}"] if f"NORM_ERR_{err}" in normed.columns else np.nan
        for stat, err in REASON_ERR_COLUMN.items() if stat in uz.columns
    }, index=df.index)
    u = per_stat_surprise(uz, ue)
    # volume gates on the shooting verdicts
    for stat, att_col, floor in (("FG_PCT", "FGA", MIN_FGA_FOR_REASON), ("FT_PCT", "FTA", MIN_FTA_FOR_REASON)):
        if stat in u.columns and att_col in df.columns:
            u[stat] = u[stat].where(df[att_col] >= floor)

    out: list[list[dict]] = []
    for idx in df.index:
        score = scores.at[idx, "SCORE"]
        if pd.isna(score):
            out.append([])
            continue
        row = u.loc[idx].dropna()
        strong = row[row.abs() >= MIN_REASON]
        ranked = strong.reindex(strong.abs().sort_values(ascending=False).index)
        lead = ranked[(ranked > 0) if score >= 0 else (ranked < 0)].head(1)
        ranked = pd.concat([lead, ranked.drop(lead.index)])
        picked = []
        for stat, c in ranked.head(N_REASONS).items():
            # His average this season; before his first game of it, over all his games.
            avg = np.nan
            for win in ("SEASON", "ALL"):
                col = f"AVG_{win}_{stat}"
                if col in df.columns and pd.notna(df.at[idx, col]):
                    avg = df.at[idx, col]
                    break
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
    normed = pd.concat([df[["MIN"]], standardize(df, calibration)], axis=1)
    raw = final_raw(normed)
    grid = np.linspace(0, 1, n_quantiles)
    # Reference for players scored on their own history alone (no model estimate).
    z_only = raw["METRIC_Z"].dropna()
    if z_only.empty:
        raise ValueError("no scorable rows: the frame carries no z-score columns")
    final = raw["FINAL_RAW"].dropna()
    if final.empty:   # a frame without any model prediction (tests, a bare season)
        final = z_only
    calibration["final_quantiles"] = [float(v) for v in np.quantile(final, grid)]
    calibration["final_count"] = int(len(final))
    calibration["z_only_quantiles"] = [float(v) for v in np.quantile(z_only, grid)]
    calibration["z_only_count"] = int(len(z_only))
    calibration["built_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    calibration["settings"] = {
        "basis": BASIS, "window_weights": WINDOW_WEIGHTS, "z_weights": Z_WEIGHTS,
        "err_weights": ERR_WEIGHTS, "volume_weight": VOLUME_WEIGHT, "blend": BLEND,
    }
    return calibration


def load_calibration(path: Path = CALIBRATION_PATH) -> dict:
    with open(path) as f:
        return json.load(f)
