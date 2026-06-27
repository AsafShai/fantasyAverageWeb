"""Training plots: CV RMSE/R2 with std bands, and per-target OOF fit with a
+/-RMSE band around the diagonal.
"""

from __future__ import annotations

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

from . import config


def _cv_overview(results: dict) -> None:
    targets = list(results)
    rmse = np.array([results[t].rmse_mean for t in targets])
    rmse_sd = np.array([results[t].rmse_std for t in targets])
    base = np.array([results[t].baseline_rmse for t in targets])
    r2 = np.array([results[t].r2_mean for t in targets])
    r2_sd = np.array([results[t].r2_std for t in targets])
    x = np.arange(len(targets))

    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(11, 8))

    # RMSE with std band (error bars) vs predict-the-mean baseline.
    ax1.bar(x, base, color="#dddddd", label="baseline RMSE (mean)")
    ax1.errorbar(
        x, rmse, yerr=rmse_sd, fmt="o", color="#1f77b4", capsize=4,
        markersize=7, label="model RMSE  (±std band)",
    )
    ax1.fill_between(x, rmse - rmse_sd, rmse + rmse_sd, color="#1f77b4", alpha=0.15)
    ax1.set_xticks(x)
    ax1.set_xticklabels(targets)
    ax1.set_ylabel("RMSE")
    ax1.set_title(f"{config.KFOLDS}-fold CV RMSE per target (lower is better)")
    ax1.legend()

    # R2 with std band.
    ax2.errorbar(x, r2, yerr=r2_sd, fmt="o", color="#2ca02c", capsize=4, markersize=7)
    ax2.fill_between(x, r2 - r2_sd, r2 + r2_sd, color="#2ca02c", alpha=0.15)
    ax2.axhline(0, color="black", lw=0.8)
    ax2.set_xticks(x)
    ax2.set_xticklabels(targets)
    ax2.set_ylabel("R²")
    ax2.set_title(f"{config.KFOLDS}-fold CV R² per target (higher is better)")

    fig.tight_layout()
    fig.savefig(config.OUTPUT_DIR / "cv_overview.png", dpi=130)
    plt.close(fig)


def _fit(result) -> None:
    yt, yp = result.oof_true, result.oof_pred
    rmse = result.rmse_mean
    lim = [0, float(max(yt.max(), yp.max())) * 1.05]
    grid = np.linspace(lim[0], lim[1], 100)

    fig, ax = plt.subplots(figsize=(5.8, 5.8))
    ax.scatter(yt, yp, s=6, alpha=0.2, edgecolors="none", color="#1f77b4")
    ax.plot(grid, grid, color="black", lw=1)
    # +/- RMSE band around the diagonal.
    ax.fill_between(grid, grid - rmse, grid + rmse, color="orange", alpha=0.18,
                    label=f"±RMSE ({rmse:.2f})")
    ax.set_xlim(lim)
    ax.set_ylim(lim)
    ax.set_xlabel("actual")
    ax.set_ylabel("predicted (out-of-fold)")
    ax.set_title(f"{result.target}: OOF fit  (R²={result.r2_mean:.2f})")
    ax.legend(loc="upper left")
    fig.tight_layout()
    fig.savefig(config.OUTPUT_DIR / f"fit_{result.target}.png", dpi=130)
    plt.close(fig)


def make_training_plots(results: dict) -> None:
    config.OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    _cv_overview(results)
    for res in results.values():
        _fit(res)
    print(f"Training plots written to {config.OUTPUT_DIR}")
