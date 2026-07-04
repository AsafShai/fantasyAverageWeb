"""Plots that show, per target, which features Lasso selected and how well it
predicts. Saves PNGs under ``outputs/``.

  - selected_<t>.png   : horizontal bar chart of the top-N selected coefficients
  - path_<t>.png       : LassoCV alpha vs mean CV error (where alpha landed)
  - fit_<t>.png        : predicted vs actual on the chronological holdout
  - overview.png       : holdout MAE vs predict-the-mean baseline, all targets
"""

from __future__ import annotations

import matplotlib

matplotlib.use("Agg")  # headless
import matplotlib.pyplot as plt
import numpy as np

from . import config
from .selection import SelectionResult


def _selected_bar(res: SelectionResult) -> None:
    sel = res.selected.iloc[::-1]  # largest at top
    colors = ["#d62728" if c < 0 else "#1f77b4" for c in sel["coef"]]
    fig, ax = plt.subplots(figsize=(9, max(5, 0.32 * len(sel))))
    ax.barh(sel["feature"], sel["coef"], color=colors)
    ax.axvline(0, color="black", lw=0.8)
    ax.set_title(f"{res.target}: top {len(sel)} Lasso-selected features (coef on standardized X)")
    ax.set_xlabel("coefficient")
    ax.tick_params(axis="y", labelsize=7)
    fig.tight_layout()
    fig.savefig(config.OUTPUT_DIR / f"selected_{res.target}.png", dpi=130)
    plt.close(fig)


def _alpha_path(res: SelectionResult) -> None:
    fig, ax = plt.subplots(figsize=(7, 4))
    ax.plot(res.alphas, res.mse_path, marker=".")
    ax.axvline(res.alpha, color="red", ls="--", label=f"chosen alpha={res.alpha:.3g}")
    ax.set_xscale("log")
    ax.set_xlabel("alpha (L1 penalty)")
    ax.set_ylabel("mean CV MSE")
    ax.set_title(f"{res.target}: LassoCV path")
    ax.legend()
    fig.tight_layout()
    fig.savefig(config.OUTPUT_DIR / f"path_{res.target}.png", dpi=130)
    plt.close(fig)


def _pred_vs_actual(res: SelectionResult) -> None:
    fig, ax = plt.subplots(figsize=(5.5, 5.5))
    ax.scatter(res.y_true, res.y_pred, s=6, alpha=0.25, edgecolors="none")
    lim = [0, max(res.y_true.max(), res.y_pred.max()) * 1.05]
    ax.plot(lim, lim, color="black", lw=1)
    ax.set_xlim(lim)
    ax.set_ylim(lim)
    ax.set_xlabel("actual")
    ax.set_ylabel("predicted")
    ax.set_title(f"{res.target}: holdout fit  (MAE={res.mae:.2f}, R2={res.r2:.2f})")
    fig.tight_layout()
    fig.savefig(config.OUTPUT_DIR / f"fit_{res.target}.png", dpi=130)
    plt.close(fig)


def _overview(results: dict[str, SelectionResult]) -> None:
    targets = list(results)
    mae = [results[t].mae for t in targets]
    base = [results[t].baseline_mae for t in targets]
    x = np.arange(len(targets))
    fig, ax = plt.subplots(figsize=(10, 4.5))
    ax.bar(x - 0.2, base, 0.4, label="baseline (mean)", color="#bbbbbb")
    ax.bar(x + 0.2, mae, 0.4, label="Lasso (selected)", color="#1f77b4")
    ax.set_xticks(x)
    ax.set_xticklabels(targets)
    ax.set_ylabel("holdout MAE")
    ax.set_title("Per-target holdout MAE vs predict-the-mean baseline")
    ax.legend()
    fig.tight_layout()
    fig.savefig(config.OUTPUT_DIR / "overview.png", dpi=130)
    plt.close(fig)


def make_plots(results: dict[str, SelectionResult]) -> None:
    config.OUTPUT_DIR.mkdir(exist_ok=True)
    for res in results.values():
        _selected_bar(res)
        _alpha_path(res)
        _pred_vs_actual(res)
    _overview(results)
    print(f"Plots written to {config.OUTPUT_DIR}")
