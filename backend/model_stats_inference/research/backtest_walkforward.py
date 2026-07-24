"""Walk-forward research backtest: train on the first 3 seasons, replay the last.

    uv run python -m model_stats_inference.research.backtest_walkforward
    uv run python -m model_stats_inference.research.backtest_walkforward --retrain

Research-only (nothing here touches prod artifacts). The flow:

1. TRAIN — build the research feature matrix from the first 3 seasons only, with
   the exact research filters (MIN_MINUTES, MIN_PLAYER_GAMES, MIN_HISTORY_GAMES),
   and fit the production estimator (config.MODEL_NAME) per target on the same
   feature sets prod uses (training/feature_sets/<T>.json). OOF residuals feed a
   season-local MinT reconciler, so predictions are coherent like prod's.
   Models are saved under research/data/walkforward_models/ and reused on later
   runs unless --retrain.

2. REPLAY — walk through every evening of the last season in order, exactly like
   the nightly service: the feature store only ever contains games strictly
   before the evening, predictions use the real minutes played, and after
   scoring the night its qualifying rows (MIN >= MIN_MINUTES) are ingested.
   A player gets a prediction only once he has >= SEASON_QUAL_GAMES qualifying
   games in THIS season's history (so a player can have z-scores but no
   estimate — e.g. his season games were all under MIN_MINUTES).

3. Z-SCORES — per stat, from the player's own distribution with DNP-only
   filtering (every played game counts, 1-minute games included), always
   computed over games strictly BEFORE tonight:
     Z_ALL_<stat>     expanding over all his games in the 4-season data
     Z_SEASON_<stat>  expanding over his games in the current season only
     Z_L10_<stat>     his previous 10 played games
     Z_L5_<stat>      his previous 5 played games

Output: one row per played game (MIN > 0) of the last season with the full raw
box-score line, PRED_/ERR_ per target (NaN when not eligible), and the z-score
columns — saved to research/data/walkforward_<season>.parquet.
"""

from __future__ import annotations

import argparse
from collections import defaultdict
from types import SimpleNamespace

import joblib
import numpy as np
import pandas as pd
from sklearn.metrics import mean_absolute_error, mean_squared_error
from sklearn.model_selection import KFold, cross_val_predict

from ..serving.feature_store import FeatureStore
from ..serving.inference import LiveInference, PredictionRequest
from ..serving import nightly
from ..training import config as tconfig
from ..training import reconcile
from . import config, data, features

# --- Knobs ------------------------------------------------------------------

TRAIN_SEASONS = config.SEASONS[:3]
EVAL_SEASON = config.SEASONS[3]

# A player needs this many qualifying (MIN >= MIN_MINUTES) games in the eval
# season's history before he gets predictions.
SEASON_QUAL_GAMES = 10

# Stats that get z-score columns (all numeric box-score stats).
Z_STATS = [
    "MIN", "PTS", "REB", "OREB", "DREB", "AST", "FG3M", "FG3A",
    "STL", "BLK", "TOV", "FGM", "FGA", "FTM", "FTA", "PF", "PLUS_MINUS",
]

MODELS_DIR = config.DATA_DIR / "walkforward_models"
OUT_PATH = config.DATA_DIR / f"walkforward_{EVAL_SEASON.replace('-', '_')}.parquet"


# --- 1) Training on the first 3 seasons -------------------------------------

# Local copies of training.train helpers (importing that module drags in
# matplotlib via its plots import, which this research env doesn't need).

def _load_feature_set(target: str) -> list[str]:
    import json

    spec = json.loads((tconfig.FEATURE_SETS_DIR / f"{target}.json").read_text())
    return spec["features"]


def _prepare(matrix: pd.DataFrame, feats: list[str], target: str):
    y_col = f"{tconfig.TARGET_PREFIX}{target}"
    sub = matrix[(matrix["HISTORY_GAMES"] >= tconfig.MIN_HISTORY_GAMES) & matrix[y_col].notna()]
    return sub[feats], sub[y_col].astype(float)


def train_models(players_raw: pd.DataFrame, team_logs: pd.DataFrame) -> None:
    """Fit one prod-config model per target on TRAIN_SEASONS only, plus reconciler."""
    tp = players_raw[players_raw["SEASON"].isin(TRAIN_SEASONS)]
    print("Filtering training players (research filters):")
    tp = data.filter_players(tp).sort_values(["PLAYER_ID", "GAME_DATE"]).reset_index(drop=True)

    tl = team_logs[team_logs["SEASON"].isin(TRAIN_SEASONS)]
    team_allowed = data.build_team_allowed(tl)
    team_own = data.build_team_own(tl)

    matrix = features.build_feature_matrix(tp, team_allowed, team_own, data.load_bio())
    print(f"Training matrix: {len(matrix):,} rows ({', '.join(TRAIN_SEASONS)})")

    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    kf = KFold(n_splits=tconfig.KFOLDS, shuffle=True, random_state=tconfig.RANDOM_STATE)
    results: dict[str, SimpleNamespace] = {}
    for target in config.TARGETS:
        feats = _load_feature_set(target)
        X, y = _prepare(matrix, feats, target)

        oof = cross_val_predict(tconfig.make_model(), X, y, cv=kf, n_jobs=-1)
        if tconfig.CLIP_AT_ZERO:
            oof = np.clip(oof, 0, None)
        rmse = float(np.sqrt(mean_squared_error(y, oof)))
        mae = float(mean_absolute_error(y, oof))

        final = tconfig.make_model()
        final.fit(X, y)
        joblib.dump(
            {
                "target": target,
                "features": feats,
                "model": final,
                "model_name": tconfig.MODEL_NAME,
                "clip_at_zero": tconfig.CLIP_AT_ZERO,
                "metrics": {"rmse_mean": rmse, "mae_mean": mae},
            },
            MODELS_DIR / f"{target}.joblib",
        )
        results[target] = SimpleNamespace(
            oof_true=y.to_numpy(), oof_pred=oof, oof_index=y.index.to_numpy()
        )
        print(f"  {target:<5} n={len(X):,}  OOF RMSE={rmse:.3f}  MAE={mae:.3f}")

    recon = reconcile.build_reconciler(results)
    joblib.dump(recon, MODELS_DIR / "reconciler.joblib")
    print(f"  reconciler: |incoherence| {recon['incoherence_before']:.3f} -> "
          f"{recon['incoherence_after']:.2e}")


def models_ready() -> bool:
    return all((MODELS_DIR / f"{t}.joblib").exists() for t in config.TARGETS) and (
        MODELS_DIR / "reconciler.joblib"
    ).exists()


# --- 2) Walk-forward replay of the last season -------------------------------

def replay_season(players_raw: pd.DataFrame, team_logs: pd.DataFrame) -> pd.DataFrame:
    """Predict every evening of EVAL_SEASON with a store that never sees the future.

    Returns one record per played game with PRED_/ERR_ columns (NaN when the
    player wasn't eligible that evening).
    """
    eval_players = players_raw[
        (players_raw["SEASON"] == EVAL_SEASON)
        & players_raw["MIN"].notna() & (players_raw["MIN"] > 0)
    ].sort_values("GAME_DATE").reset_index(drop=True)
    eval_teams = team_logs[team_logs["SEASON"] == EVAL_SEASON]
    season_start = eval_players["GAME_DATE"].min()

    # Store seed: qualifying rows strictly before the season, mirroring prod's
    # bootstrap (stale players dropped as of the snapshot date).
    hist = players_raw[
        players_raw["MIN"].notna()
        & (players_raw["MIN"] >= config.MIN_MINUTES)
        & (players_raw["GAME_DATE"] < season_start)
    ].sort_values(["PLAYER_ID", "GAME_DATE"]).reset_index(drop=True)
    hist["POSITION"] = hist["POSITION"].fillna("")
    hist = nightly.drop_stale_players(hist, season_start.date())

    tl_hist = team_logs[team_logs["GAME_DATE"] < season_start]
    print(f"Building feature store as of {season_start.date()} "
          f"({hist['PLAYER_ID'].nunique():,} players)...")
    store = FeatureStore.build(hist, data.build_team_allowed(tl_hist), data.build_team_own(tl_hist))
    inference = LiveInference(store, models_dir=MODELS_DIR)

    season_qual: dict[int, int] = defaultdict(int)
    records: list[dict] = []
    dates = sorted(eval_players["GAME_DATE"].unique())
    print(f"Replaying {len(dates)} evenings of {EVAL_SEASON}...")

    for i, d in enumerate(dates):
        night_p = eval_players[eval_players["GAME_DATE"] == d]
        night_t = eval_teams[eval_teams["GAME_DATE"] == d]
        night_p = nightly.attach_positions(store, night_p)

        opp_map = (
            data.build_team_allowed(night_t)
            .set_index(["GAME_ID", "TEAM_ID"])["OPP_TEAM_ID"]
            .to_dict()
        )

        reqs: list[PredictionRequest] = []
        metas: list[dict] = []
        for _, row in night_p.iterrows():
            pid = int(row["PLAYER_ID"])
            rec = {
                "PLAYER_ID": pid,
                "GAME_ID": row["GAME_ID"],
                "SEASON_QUAL_GAMES": season_qual[pid],
                "ELIGIBLE": False,
                "REASON": "",
            }
            records.append(rec)
            opp = int(opp_map.get((row["GAME_ID"], row["TEAM_ID"]), -1))
            if season_qual[pid] < SEASON_QUAL_GAMES:
                rec["REASON"] = f"only {season_qual[pid]} qualifying games this season"
                continue
            if opp not in store.team_allowed_vectors.index:
                rec["REASON"] = f"opponent team {opp} not in feature store"
                continue
            reqs.append(PredictionRequest(
                player_id=pid,
                opponent_team_id=opp,
                is_home="vs" in str(row["MATCHUP"]),
                game_date=pd.Timestamp(d),
                minutes=float(row["MIN"]),
            ))
            metas.append(rec)

        results, errors = inference.predict_many(reqs)
        for rec, res, err in zip(metas, results, errors):
            if err is not None:
                rec["REASON"] = str(err)
                continue
            rec["ELIGIBLE"] = True
            for stat, sp in res.stats.items():
                rec[f"PRED_{stat}"] = sp.value

        # Fold the night in (qualifying rows only — the same population prod's
        # read boundary get_fs_rows_before exposes to the store).
        qual = night_p[night_p["MIN"] >= config.MIN_MINUTES]
        if not qual.empty:
            store.update_with_nightly_results(qual, night_t)
            for pid in qual["PLAYER_ID"]:
                season_qual[int(pid)] += 1

        if (i + 1) % 20 == 0 or i == len(dates) - 1:
            n_pred = sum(r["ELIGIBLE"] for r in records)
            print(f"  {i + 1}/{len(dates)} evenings ({pd.Timestamp(d).date()}), "
                  f"{n_pred:,} predictions so far")

    return pd.DataFrame(records)


# --- 3) Z-scores (DNP-only filtering, strictly-prior windows) ----------------

def compute_zscores(players_raw: pd.DataFrame) -> pd.DataFrame:
    """Per player-game surprise scores for Z_STATS over played games (MIN > 0).

    Every base excludes tonight's game: *_ALL uses the expanding 4-season
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
    """
    from scipy.stats import norm as _norm

    zdf = players_raw[players_raw["MIN"].notna() & (players_raw["MIN"] > 0)]
    zdf = zdf.sort_values(["PLAYER_ID", "GAME_DATE"]).reset_index(drop=True)

    out = zdf[["PLAYER_ID", "GAME_ID"]].copy()
    pid = zdf["PLAYER_ID"]
    season_keys = [pid, zdf["SEASON"]]
    n_all = zdf.groupby("PLAYER_ID").cumcount().astype(float)          # prior games
    n_season = zdf.groupby(["PLAYER_ID", "SEASON"]).cumcount().astype(float)

    for stat in Z_STATS:
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
            return pd.Series(_norm.ppf(pct), index=s.index)

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
            out[f"Z_{win}_{stat}"] = z(mean, std)
            out[f"PZ_{win}_{stat}"] = pearson(mean)

        # Percentile ranks: window INCLUDES tonight (rank - 1 scores vs priors).
        out[f"QZ_ALL_{stat}"] = probit(
            s.groupby(pid).expanding(min_periods=2).rank().droplevel(0), n_all)
        out[f"QZ_SEASON_{stat}"] = probit(
            s.groupby(season_keys).expanding(min_periods=2).rank().droplevel([0, 1]),
            n_season)
        out[f"QZ_L10_{stat}"] = probit(
            s.groupby(pid).rolling(11, min_periods=11).rank().droplevel(0), 10.0)
        out[f"QZ_L5_{stat}"] = probit(
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
    # (no variance to normalize by). Stored identically under Z/PZ/QZ so the
    # dashboard basis toggle is a no-op for these categories.
    for num, den, name in [("FGM", "FGA", "FG_PCT"), ("FTM", "FTA", "FT_PCT"),
                           ("FG3M", "FG3A", "FG3_PCT")]:
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
            out[f"Z_{win}_{name}"] = binom_z
            out[f"PZ_{win}_{name}"] = binom_z
            out[f"QZ_{win}_{name}"] = binom_z
    return out


# --- Normalized columns (surprise-method inputs) -----------------------------

def add_normalized_columns(df: pd.DataFrame) -> pd.DataFrame:
    """Standardize every surprise-relevant column to mean 0 / var 1.

    For each z-score column (Z_ALL_/Z_SEASON_/Z_L10_/Z_L5_) and each model-error
    column (ERR_), add a NORM_<col> twin: (x - mean) / std over the column's
    non-null values in this dataframe. These are the comparable ingredients a
    weighted "surprise" score can be built from.
    """
    families = ("Z", "PZ", "QZ")
    windows = ("ALL", "SEASON", "L10", "L5")
    prefixes = tuple(f"{f}_{w}_" for f in families for w in windows) + ("ERR_",)
    cols = [c for c in df.columns if c.startswith(prefixes)]
    for c in cols:
        std = df[c].std()
        df[f"NORM_{c}"] = (df[c] - df[c].mean()) / std if std and std > 0 else np.nan
    print(f"Added {len(cols)} NORM_ columns (mean 0 / var 1)")
    return df


# --- Orchestration -----------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--retrain", action="store_true",
                        help="retrain the walk-forward models even if cached")
    args = parser.parse_args()

    print(f"Loading raw logs for {', '.join(config.SEASONS)} (month cache)...")
    players_raw, team_logs = data.fetch_game_logs(config.SEASONS)
    players_raw = data._to_datetime(players_raw)
    team_logs = data._to_datetime(team_logs)

    if args.retrain or not models_ready():
        train_models(players_raw, team_logs)
    else:
        print(f"Reusing trained models in {MODELS_DIR} (use --retrain to refit)")

    preds = replay_season(players_raw, team_logs)
    zscores = compute_zscores(players_raw)

    # Base rows: every played game of the eval season with the full raw line.
    base = players_raw[
        (players_raw["SEASON"] == EVAL_SEASON)
        & players_raw["MIN"].notna() & (players_raw["MIN"] > 0)
    ].sort_values(["GAME_DATE", "PLAYER_ID"]).reset_index(drop=True)

    df = base.merge(preds, on=["PLAYER_ID", "GAME_ID"], how="left")
    df = df.merge(zscores, on=["PLAYER_ID", "GAME_ID"], how="left")
    df["ELIGIBLE"] = df["ELIGIBLE"].fillna(False).astype(bool)

    # Actual shooting percentages + per-target errors (actual - predicted).
    df["FG_PCT"] = np.where(df["FGA"] > 0, df["FGM"] / df["FGA"], np.nan)
    df["FT_PCT"] = np.where(df["FTA"] > 0, df["FTM"] / df["FTA"], np.nan)
    for stat in config.TARGETS + ["FG_PCT", "FT_PCT"]:
        df[f"ERR_{stat}"] = df[stat] - df[f"PRED_{stat}"]

    df = add_normalized_columns(df)

    config.DATA_DIR.mkdir(exist_ok=True)
    df.to_parquet(OUT_PATH, index=False)

    n_pred = int(df["ELIGIBLE"].sum())
    print(f"\nSaved {len(df):,} rows ({n_pred:,} with predictions, "
          f"{df['PLAYER_ID'].nunique():,} players) -> {OUT_PATH}")
    scored = df[df["ELIGIBLE"]]
    if not scored.empty:
        print("Walk-forward MAE on predicted rows:")
        for t in config.TARGETS:
            print(f"  {t:<5} {scored[f'ERR_{t}'].abs().mean():.3f}")


if __name__ == "__main__":
    main()
