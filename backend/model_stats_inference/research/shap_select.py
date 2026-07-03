"""SHAP-based feature selection, validated on a held-out TEST split.

Per target, the protocol is test-isolated:
  1. Chronological split on GAME_DATE: TRAIN 70% / VALID 15% / TEST 15%.
  2. Fit a LightGBM surrogate on TRAIN with ALL features (SHAP's fast TreeExplainer
     supports LightGBM; sklearn HistGradientBoosting it does not).
  3. SHAP on VALID → rank features by mean(|SHAP|).
  4. Sweep k, retrain the PRODUCTION model (HGB-Poisson) on TRAIN with the top-k,
     pick k* by VALID RMSE.
  5. Retrain HGB-Poisson on TRAIN+VALID with top-k*, report TEST RMSE — and compare
     to the current Lasso-50 set on the SAME test split.
TEST is only ever used for the final number; ranking + k-pick use TRAIN/VALID only.
"""

from __future__ import annotations

import json

import numpy as np
import pandas as pd
from lightgbm import LGBMRegressor
from sklearn.metrics import mean_squared_error

from . import config, features as F
from ..training import config as tconfig

K_GRID = [30, 40, 50, 55, 70, 100]
SHAP_SAMPLE = 4000          # rows of VALID used for the SHAP pass (speed)
TRAIN_FRAC, VALID_FRAC = 0.70, 0.15


def _splits(matrix: pd.DataFrame, feature_cols: list[str], target: str):
    y_col = f"{tconfig.TARGET_PREFIX}{target}"
    sub = matrix[(matrix["HISTORY_GAMES"] >= tconfig.MIN_HISTORY_GAMES) & matrix[y_col].notna()]
    sub = sub.sort_values("GAME_DATE")
    X, y = sub[feature_cols], sub[y_col].astype(float)
    n = len(sub)
    a, b = int(n * TRAIN_FRAC), int(n * (TRAIN_FRAC + VALID_FRAC))
    return X, y, (slice(0, a), slice(a, b), slice(b, n))


def _rmse(model, Xtr, ytr, Xte, yte) -> float:
    model.fit(Xtr, ytr)
    p = np.clip(model.predict(Xte), 0, None)
    return float(np.sqrt(mean_squared_error(yte, p)))


def _lasso_features(target: str) -> list[str]:
    p = tconfig.FEATURE_SETS_DIR / f"{target}.json"
    return json.loads(p.read_text())["features"] if p.exists() else []


def select_for_target(matrix: pd.DataFrame, feature_cols: list[str], target: str) -> dict:
    X, y, (tr, va, te) = _splits(matrix, feature_cols, target)
    Xtr, ytr = X.iloc[tr], y.iloc[tr]
    Xva, yva = X.iloc[va], y.iloc[va]
    Xte, yte = X.iloc[te], y.iloc[te]
    Xtrva, ytrva = X.iloc[: te.start], y.iloc[: te.start]   # train+valid

    # 1) LightGBM surrogate on TRAIN, SHAP ranking on a VALID sample.
    surrogate = LGBMRegressor(objective="poisson", n_estimators=500, learning_rate=0.05,
                              num_leaves=31, n_jobs=-1, verbose=-1, random_state=0)
    surrogate.fit(Xtr, ytr)
    import shap
    samp = Xva.sample(min(SHAP_SAMPLE, len(Xva)), random_state=0)
    sv = shap.TreeExplainer(surrogate).shap_values(samp)
    importance = pd.Series(np.abs(sv).mean(axis=0), index=feature_cols).sort_values(ascending=False)
    ranked = importance.index.tolist()

    # 2) Pick k by VALID RMSE (HGB-Poisson on TRAIN, scored on VALID).
    val_curve = {}
    for k in K_GRID:
        feats = ranked[:k]
        val_curve[k] = _rmse(tconfig.make_model(), Xtr[feats], ytr, Xva[feats], yva)
    k_star = min(val_curve, key=val_curve.get)
    shap_feats = ranked[:k_star]

    # 3) Final TEST RMSE (HGB-Poisson on TRAIN+VALID), shap-k* vs lasso-50 vs all.
    test_shap = _rmse(tconfig.make_model(), Xtrva[shap_feats], ytrva, Xte[shap_feats], yte)
    lasso = [f for f in _lasso_features(target) if f in X.columns]
    test_lasso = _rmse(tconfig.make_model(), Xtrva[lasso], ytrva, Xte[lasso], yte) if lasso else float("nan")
    test_all = _rmse(tconfig.make_model(), Xtrva, ytrva, Xte, yte)

    return {
        "target": target,
        "k_star": k_star,
        "test_rmse_lasso50": test_lasso,
        "test_rmse_shap": test_shap,
        "test_rmse_all": test_all,
        "delta_vs_lasso": test_shap - test_lasso,
        "val_curve": val_curve,
        "selected": shap_feats,
        "top15": ranked[:15],
        "n_engineered_in_top": sum(1 for f in shap_feats if f not in lasso),
    }


def run_shap_selection(matrix: pd.DataFrame) -> dict[str, dict]:
    feature_cols = F.feature_columns(matrix)
    print(f"SHAP selection over {len(feature_cols)} features, {len(tconfig.TARGETS)} targets")
    results, selected = {}, {}
    print(f"\n{'stat':<6}{'k*':>5}{'lasso50':>9}{'shap':>9}{'all':>9}{'Δvs L':>9}   eng/top")
    for t in tconfig.TARGETS:
        r = select_for_target(matrix, feature_cols, t)
        results[t] = r
        selected[t] = r["selected"]
        print(f"{t:<6}{r['k_star']:>5}{r['test_rmse_lasso50']:>9.3f}{r['test_rmse_shap']:>9.3f}"
              f"{r['test_rmse_all']:>9.3f}{r['delta_vs_lasso']:>+9.4f}   {r['n_engineered_in_top']}/{r['k_star']}")

    config.OUTPUT_DIR.mkdir(exist_ok=True)
    (config.OUTPUT_DIR / "selected_features_shap.json").write_text(json.dumps(selected, indent=2))
    pd.DataFrame([
        {"target": r["target"], "k_star": r["k_star"],
         "test_rmse_lasso50": r["test_rmse_lasso50"], "test_rmse_shap": r["test_rmse_shap"],
         "test_rmse_all": r["test_rmse_all"], "delta_vs_lasso": r["delta_vs_lasso"],
         "n_engineered_in_top": r["n_engineered_in_top"], "top15": "; ".join(r["top15"])}
        for r in results.values()
    ]).to_csv(config.OUTPUT_DIR / "shap_summary.csv", index=False)

    tb = sum(r["test_rmse_lasso50"] for r in results.values())
    ts = sum(r["test_rmse_shap"] for r in results.values())
    print(f"\nTOTAL test RMSE  lasso50={tb:.3f}  shap={ts:.3f}  Δ={ts - tb:+.4f} ({(ts-tb)/tb*100:+.2f}%)")
    print(f"Wrote selected_features_shap.json + shap_summary.csv -> {config.OUTPUT_DIR}")
    return results
