"""Bake-off: score several registered estimators on the same features + folds.

    uv run python -m model_stats_inference.training.compare_models
    uv run python -m model_stats_inference.training.compare_models --models hgb_l2 linear

For every target stat, each estimator from the registry is cross-validated on the
*identical* feature set and KFold splits used in training (so differences come only
from the model/loss), then a per-stat leaderboard is printed and written to
outputs/model_comparison.{csv,png}. Does NOT touch the production models/ joblibs.
"""

from __future__ import annotations

import argparse

import pandas as pd

from . import config
from . import models as registry
from .train import cross_validate_target, ensure_feature_sets, load_feature_set, _prepare

BASELINE = "hgb_l2"  # Δ columns are reported relative to this model.


def run(model_names: list[str]) -> pd.DataFrame:
    if not config.FEATURE_MATRIX.exists():
        raise FileNotFoundError(
            f"{config.FEATURE_MATRIX} not found — run the research pipeline first."
        )
    matrix = pd.read_parquet(config.FEATURE_MATRIX)
    ensure_feature_sets()

    print(f"Comparing {model_names} on {len(config.TARGETS)} targets "
          f"({config.KFOLDS}-fold CV, same features)\n")

    rows = []
    for target in config.TARGETS:
        features = load_feature_set(target)
        X, y = _prepare(matrix, features, target)
        for name in model_names:
            res = cross_validate_target(
                X, y, target, features, make_est=lambda n=name: registry.build_estimator(n)
            )
            rows.append({
                "target": target,
                "model": name,
                "rmse": res.rmse_mean,
                "rmse_std": res.rmse_std,
                "mae": res.mae_mean,
                "r2": res.r2_mean,
            })
    df = pd.DataFrame(rows)

    _print_leaderboard(df, model_names)
    _write_outputs(df, model_names)
    return df


def _print_leaderboard(df: pd.DataFrame, model_names: list[str]) -> None:
    base = BASELINE if BASELINE in model_names else model_names[0]
    for target in config.TARGETS:
        sub = df[df["target"] == target].set_index("model")
        base_rmse = sub.loc[base, "rmse"] if base in sub.index else None
        best = sub["rmse"].idxmin()
        print(f"{target}:")
        for name in model_names:
            if name not in sub.index:
                continue
            r = sub.loc[name]
            delta = "" if base_rmse is None else f"  ΔRMSE={r['rmse'] - base_rmse:+.3f}"
            star = " *" if name == best else "  "
            print(f"  {name:<12} RMSE={r['rmse']:.3f}±{r['rmse_std']:.3f}  "
                  f"MAE={r['mae']:.3f}  R2={r['r2']:.3f}{delta}{star}")
        print()
    print("(* = lowest RMSE for that stat; Δ vs "
          f"{base})")


def _write_outputs(df: pd.DataFrame, model_names: list[str]) -> None:
    config.OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    csv_path = config.OUTPUT_DIR / "model_comparison.csv"
    df.to_csv(csv_path, index=False)

    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        import numpy as np

        targets = list(config.TARGETS)
        x = np.arange(len(targets))
        width = 0.8 / max(1, len(model_names))
        fig, ax = plt.subplots(figsize=(max(8, len(targets) * 1.1), 5))
        for i, name in enumerate(model_names):
            vals = [df[(df.target == t) & (df.model == name)]["rmse"].mean() for t in targets]
            ax.bar(x + i * width, vals, width, label=name)
        ax.set_xticks(x + width * (len(model_names) - 1) / 2)
        ax.set_xticklabels(targets)
        ax.set_ylabel("CV RMSE (lower is better)")
        ax.set_title("Model comparison — RMSE per target")
        ax.legend()
        fig.tight_layout()
        png_path = config.OUTPUT_DIR / "model_comparison.png"
        fig.savefig(png_path, dpi=120)
        plt.close(fig)
        print(f"\nWrote {csv_path.name} and {png_path.name} -> {config.OUTPUT_DIR}")
    except Exception as exc:  # plotting is best-effort; the CSV is the source of truth
        print(f"\nWrote {csv_path.name} -> {config.OUTPUT_DIR} (plot skipped: {exc})")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--models", nargs="+", default=registry.list_estimators(),
        help=f"registered estimators to compare (default: all = {registry.list_estimators()})",
    )
    args = ap.parse_args()
    unknown = [m for m in args.models if m not in registry.ESTIMATORS]
    if unknown:
        raise SystemExit(f"unknown estimator(s): {unknown}; registered: {registry.list_estimators()}")
    run(args.models)


if __name__ == "__main__":
    main()
