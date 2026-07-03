"""Per-target feature selection with LassoCV (chronological CV).

For each target stat we standardize the ~200 features, fit an L1 (Lasso) model
whose penalty drives most weights to zero, and keep the ~30 features with the
largest |coefficient|. Alpha is chosen by cross-validation that respects time
order (``TimeSeriesSplit``) so the selection never peeks at the future.

Honest generalization metrics come from a separate chronological holdout (train
on the earliest 80% of games, score the latest 20%).
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd
from sklearn.linear_model import Lasso, LassoCV
from sklearn.metrics import mean_absolute_error, r2_score
from sklearn.model_selection import TimeSeriesSplit
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.impute import SimpleImputer

from . import config


@dataclass
class SelectionResult:
    target: str
    alpha: float
    n_rows: int
    mae: float
    r2: float
    baseline_mae: float            # predict-the-mean baseline on the holdout
    coef: pd.Series                # full coefficient vector (index = feature)
    selected: pd.DataFrame         # top-N: feature, coef, abs_coef
    alphas: np.ndarray = field(repr=False)      # LassoCV alpha path
    mse_path: np.ndarray = field(repr=False)    # mean CV MSE per alpha
    y_true: np.ndarray = field(repr=False)      # holdout actuals
    y_pred: np.ndarray = field(repr=False)      # holdout predictions


def _pipeline(estimator) -> Pipeline:
    return Pipeline(
        [
            ("impute", SimpleImputer(strategy="median")),
            ("scale", StandardScaler()),
            ("model", estimator),
        ]
    )


def _prepare(matrix: pd.DataFrame, feature_cols: list[str], target: str):
    """Training rows for a target, sorted chronologically; drop unusable rows."""
    y_col = f"y_{target}"
    sub = matrix[matrix["HISTORY_GAMES"] >= config.MIN_HISTORY_GAMES]
    sub = sub[sub[y_col].notna()]
    sub = sub.sort_values("GAME_DATE")
    X = sub[feature_cols]
    y = sub[y_col].astype(float)
    return X, y


def select_for_target(matrix: pd.DataFrame, feature_cols: list[str], target: str) -> SelectionResult:
    X, y = _prepare(matrix, feature_cols, target)
    tscv = TimeSeriesSplit(n_splits=config.CV_SPLITS)

    # --- selection model: LassoCV on all rows, alpha by chronological CV -----
    select_pipe = _pipeline(
        LassoCV(cv=tscv, max_iter=5000, n_jobs=-1, random_state=0)
    )
    select_pipe.fit(X, y)
    lasso: LassoCV = select_pipe.named_steps["model"]

    coef = pd.Series(lasso.coef_, index=feature_cols, name="coef")
    ranked = coef.reindex(coef.abs().sort_values(ascending=False).index)
    selected = ranked.head(config.N_SELECT)
    selected_df = pd.DataFrame(
        {"feature": selected.index, "coef": selected.to_numpy(), "abs_coef": selected.abs().to_numpy()}
    ).reset_index(drop=True)

    # --- honest metrics: chronological 80/20 holdout -------------------------
    split = int(len(X) * 0.8)
    X_tr, X_te = X.iloc[:split], X.iloc[split:]
    y_tr, y_te = y.iloc[:split], y.iloc[split:]
    eval_pipe = _pipeline(Lasso(alpha=lasso.alpha_, max_iter=5000))
    eval_pipe.fit(X_tr, y_tr)
    y_pred = eval_pipe.predict(X_te)

    mae = mean_absolute_error(y_te, y_pred)
    r2 = r2_score(y_te, y_pred)
    baseline_mae = mean_absolute_error(y_te, np.full_like(y_te, y_tr.mean(), dtype=float))

    return SelectionResult(
        target=target,
        alpha=float(lasso.alpha_),
        n_rows=len(X),
        mae=float(mae),
        r2=float(r2),
        baseline_mae=float(baseline_mae),
        coef=coef,
        selected=selected_df,
        alphas=lasso.alphas_,
        mse_path=lasso.mse_path_.mean(axis=1),
        y_true=y_te.to_numpy(),
        y_pred=y_pred,
    )


def run_selection(matrix: pd.DataFrame) -> dict[str, SelectionResult]:
    config.OUTPUT_DIR.mkdir(exist_ok=True)
    feature_cols = [
        c for c in matrix.columns
        if c not in {"SEASON", "PLAYER_ID", "PLAYER_NAME", "TEAM_ID",
                     "OPP_TEAM_ID", "GAME_ID", "GAME_DATE"}
        and not c.startswith("y_")
    ]
    print(f"\nFeature matrix: {len(matrix):,} rows x {len(feature_cols)} features")

    results: dict[str, SelectionResult] = {}
    summary_rows = []
    for target in config.TARGETS:
        print(f"  selecting for {target} ...", flush=True)
        res = select_for_target(matrix, feature_cols, target)
        results[target] = res
        res.selected.to_csv(config.OUTPUT_DIR / f"selected_{target}.csv", index=False)
        nonzero = int((res.coef != 0).sum())
        print(
            f"    alpha={res.alpha:.4g}  nonzero={nonzero}  kept={len(res.selected)}  "
            f"holdout MAE={res.mae:.3f} (baseline {res.baseline_mae:.3f})  R2={res.r2:.3f}"
        )
        summary_rows.append(
            {
                "target": target,
                "alpha": res.alpha,
                "n_rows": res.n_rows,
                "nonzero": nonzero,
                "n_selected": len(res.selected),
                "holdout_mae": res.mae,
                "baseline_mae": res.baseline_mae,
                "r2": res.r2,
            }
        )

    pd.DataFrame(summary_rows).to_csv(config.OUTPUT_DIR / "summary.csv", index=False)
    return results
