"""Train one model per target stat on its own selected feature set.

    uv run python -m model_stats_inference.training.train

For each target:
  - load its feature list from training/feature_sets/<target>.json
    (seeded from the research selection on first run; edit those files to change
    which features a model trains on)
  - run K-fold CV -> per-fold RMSE / MAE / R2 (mean +/- std) + out-of-fold preds
  - fit a final model on all rows and save it to model_stats_inference/models/
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field

import joblib
import numpy as np
import pandas as pd
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.model_selection import KFold, cross_val_predict

from . import config
from . import plots


@dataclass
class TrainResult:
    target: str
    features: list[str]
    n_rows: int
    rmse_mean: float
    rmse_std: float
    mae_mean: float
    mae_std: float
    r2_mean: float
    r2_std: float
    baseline_rmse: float
    oof_true: np.ndarray = field(repr=False)
    oof_pred: np.ndarray = field(repr=False)


def ensure_feature_sets() -> None:
    """Create training/feature_sets/<target>.json from the research selection."""
    config.FEATURE_SETS_DIR.mkdir(parents=True, exist_ok=True)
    missing = [t for t in config.TARGETS if not (config.FEATURE_SETS_DIR / f"{t}.json").exists()]
    if not missing:
        return
    if not config.SELECTED_JSON.exists():
        raise FileNotFoundError(
            f"{config.SELECTED_JSON} not found — run the research pipeline first."
        )
    selected = json.loads(config.SELECTED_JSON.read_text())
    for target in missing:
        feats = selected.get(target)
        if not feats:
            raise KeyError(f"No selected features for target {target} in {config.SELECTED_JSON}")
        path = config.FEATURE_SETS_DIR / f"{target}.json"
        path.write_text(json.dumps({"target": target, "features": feats}, indent=2))
        print(f"  seeded feature set -> {path.name} ({len(feats)} features)")


def load_feature_set(target: str) -> list[str]:
    spec = json.loads((config.FEATURE_SETS_DIR / f"{target}.json").read_text())
    return spec["features"]


def _prepare(matrix: pd.DataFrame, features: list[str], target: str):
    y_col = f"{config.TARGET_PREFIX}{target}"
    sub = matrix[(matrix["HISTORY_GAMES"] >= config.MIN_HISTORY_GAMES) & matrix[y_col].notna()]
    return sub[features], sub[y_col].astype(float)


def train_target(matrix: pd.DataFrame, target: str) -> TrainResult:
    features = load_feature_set(target)
    X, y = _prepare(matrix, features, target)
    kf = KFold(n_splits=config.KFOLDS, shuffle=True, random_state=config.RANDOM_STATE)

    # Per-fold metrics (so we get a std / band), computed on each fold's test part.
    rmses, maes, r2s = [], [], []
    for tr, te in kf.split(X):
        model = config.make_model()
        model.fit(X.iloc[tr], y.iloc[tr])
        pred = model.predict(X.iloc[te])
        if config.CLIP_AT_ZERO:
            pred = np.clip(pred, 0, None)
        rmses.append(np.sqrt(mean_squared_error(y.iloc[te], pred)))
        maes.append(mean_absolute_error(y.iloc[te], pred))
        r2s.append(r2_score(y.iloc[te], pred))

    # Out-of-fold predictions for the scatter plot.
    oof = cross_val_predict(config.make_model(), X, y, cv=kf, n_jobs=-1)
    if config.CLIP_AT_ZERO:
        oof = np.clip(oof, 0, None)

    baseline_rmse = float(np.sqrt(mean_squared_error(y, np.full(len(y), y.mean()))))

    # Final model trained on everything, then saved.
    final = config.make_model()
    final.fit(X, y)
    config.MODELS_DIR.mkdir(parents=True, exist_ok=True)
    joblib.dump(
        {
            "target": target,
            "features": features,
            "model": final,
            "clip_at_zero": config.CLIP_AT_ZERO,
            "metrics": {
                "rmse_mean": float(np.mean(rmses)),
                "rmse_std": float(np.std(rmses)),
                "mae_mean": float(np.mean(maes)),
                "r2_mean": float(np.mean(r2s)),
            },
        },
        config.MODELS_DIR / f"{target}.joblib",
    )

    return TrainResult(
        target=target,
        features=features,
        n_rows=len(X),
        rmse_mean=float(np.mean(rmses)),
        rmse_std=float(np.std(rmses)),
        mae_mean=float(np.mean(maes)),
        mae_std=float(np.std(maes)),
        r2_mean=float(np.mean(r2s)),
        r2_std=float(np.std(r2s)),
        baseline_rmse=baseline_rmse,
        oof_true=y.to_numpy(),
        oof_pred=oof,
    )


def main() -> None:
    if not config.FEATURE_MATRIX.exists():
        raise FileNotFoundError(
            f"{config.FEATURE_MATRIX} not found — run the research pipeline first."
        )
    matrix = pd.read_parquet(config.FEATURE_MATRIX)
    ensure_feature_sets()
    print(f"Feature matrix: {len(matrix):,} rows; training {len(config.TARGETS)} models "
          f"({config.KFOLDS}-fold CV)\n")

    results: dict[str, TrainResult] = {}
    card = {}
    for target in config.TARGETS:
        res = train_target(matrix, target)
        results[target] = res
        print(
            f"  {target:<5} n={res.n_rows:,}  "
            f"RMSE={res.rmse_mean:.3f}±{res.rmse_std:.3f} (baseline {res.baseline_rmse:.3f})  "
            f"MAE={res.mae_mean:.3f}  R2={res.r2_mean:.3f}±{res.r2_std:.3f}  "
            f"[{len(res.features)} feats]"
        )
        card[target] = {
            "n_rows": res.n_rows,
            "n_features": len(res.features),
            "rmse_mean": res.rmse_mean,
            "rmse_std": res.rmse_std,
            "mae_mean": res.mae_mean,
            "r2_mean": res.r2_mean,
            "r2_std": res.r2_std,
            "baseline_rmse": res.baseline_rmse,
        }

    config.OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    (config.MODELS_DIR / "model_card.json").write_text(json.dumps(card, indent=2))
    plots.make_training_plots(results)
    print(f"\nModels -> {config.MODELS_DIR}\nPlots  -> {config.OUTPUT_DIR}")


if __name__ == "__main__":
    main()
