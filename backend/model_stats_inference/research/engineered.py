"""Non-linear engineered features (ratios + products) on top of the base matrix.

Trees split on one feature vs a constant; they cannot synthesize `a/b` or `a*b`
themselves. So we hand them the ratios/interactions explicitly. Every feature here
is a pure function of *existing leakage-safe* columns (pre-game history + `T_MIN`,
the known label-time minutes), so the result is leakage-safe by construction — and
the exact same function can be applied to a serving row if a feature gets adopted.

`add_engineered_features(matrix)` appends the new columns (guarded division → NaN,
which the trees tolerate), drops constant / all-NaN / duplicate columns, and returns
the widened matrix. Aim: ~300 new features → ~600 total.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from . import config

WINDOWS = ["global", "w10", "w5"]
_EPS = 1e-6


def _div(a: pd.Series, b: pd.Series) -> np.ndarray:
    """a / b, NaN where b≈0 (rate undefined) — trees handle NaN natively."""
    an, bn = a.to_numpy(float), b.to_numpy(float)
    return np.divide(an, bn, out=np.full_like(an, np.nan), where=np.abs(bn) > _EPS)


def add_engineered_features(matrix: pd.DataFrame) -> pd.DataFrame:
    cols = set(matrix.columns)
    has = lambda c: c in cols  # noqa: E731
    out: dict[str, np.ndarray] = {}

    def ratio(name, num, den):
        if has(num) and has(den):
            out[name] = _div(matrix[num], matrix[den])

    def product(name, a, b):
        if has(a) and has(b):
            out[name] = matrix[a].to_numpy(float) * matrix[b].to_numpy(float)

    # 1) Form ratios — recent production vs longer baseline (hot/cold).
    for s in config.BASE_STATS:
        ratio(f"{s}_form_w5_global", f"{s}_w5_mean", f"{s}_global_mean")
        ratio(f"{s}_form_w10_global", f"{s}_w10_mean", f"{s}_global_mean")
        ratio(f"{s}_form_w5_w10", f"{s}_w5_mean", f"{s}_w10_mean")
    # 2) Per-minute efficiency form (rate recent vs baseline).
    for s in config.RATE_STATS:
        ratio(f"{s}_rateform_w5_global", f"{s}_w5_rate", f"{s}_global_rate")
        ratio(f"{s}_rateform_w10_global", f"{s}_w10_rate", f"{s}_global_rate")
        ratio(f"{s}_rateform_w5_w10", f"{s}_w5_rate", f"{s}_w10_rate")
    # 3) Dispersion — coefficient of variation (consistency vs volatility).
    for s in config.BASE_STATS:
        for w in WINDOWS:
            ratio(f"{s}_cov_{w}", f"{s}_{w}_var", f"{s}_{w}_mean")

    # 4) Minutes vs usual (the "playing more than normal?" axis).
    for w in WINDOWS:
        ratio(f"T_over_MIN_{w}", "T_MIN", f"MIN_{w}_mean")

    # 5) Basketball ratios per window (usage / shot mix / efficiency).
    pairs = [
        ("FG3A", "FGA", "threeRate"), ("FTA", "FGA", "ftRate"), ("AST", "TOV", "astTov"),
        ("OREB", "REB", "orebShare"), ("DREB", "REB", "drebShare"), ("PTS", "FGA", "ptsPerShot"),
        ("FG3M", "FGM", "threeShare"), ("FGM", "FGA", "fgPct"), ("FTM", "FTA", "ftPct"),
        ("FG3M", "FG3A", "fg3Pct"), ("STL", "PF", "stlPf"), ("BLK", "PF", "blkPf"),
        ("AST", "FGM", "astPerFgm"), ("PTS", "MIN", "ptsPerMin"),
    ]
    for num, den, name in pairs:
        for w in WINDOWS:
            ratio(f"{name}_{w}", f"{num}_{w}_mean", f"{den}_{w}_mean")

    # 6) Matchup: player rate × what the opponent allows; opp recent vs own baseline.
    for s in config.OPP_ALLOWED_STATS:
        product(f"matchup_{s}_w5", f"{s}_w5_rate", f"OPP_ALLOWED_{s}_w10_mean")
        product(f"matchup_{s}_global", f"{s}_global_rate", f"OPP_ALLOWED_{s}_global_mean")
        ratio(f"oppDef_{s}_w5", f"OPP_ALLOWED_{s}_w5_mean", f"OPP_ALLOWED_{s}_global_mean")
        ratio(f"oppDef_{s}_w10", f"OPP_ALLOWED_{s}_w10_mean", f"OPP_ALLOWED_{s}_global_mean")
        # player rate relative to what the opponent gives up
        ratio(f"edge_{s}_w10", f"{s}_w10_rate", f"OPP_ALLOWED_{s}_w10_mean")

    # 7) Minutes-scaled non-linear interactions (the strongest signal is t × rate).
    for s in config.RATE_STATS:
        if has("T_MIN") and has(f"{s}_w5_rate") and has(f"{s}_global_rate"):
            rf = _div(matrix[f"{s}_w5_rate"], matrix[f"{s}_global_rate"])
            out[f"T_x_{s}_rateform"] = matrix["T_MIN"].to_numpy(float) * rf
    for eff in ["FG_EFF_w5", "FG3_EFF_w5", "FT_EFF_w5"]:
        product(f"T_x_{eff}", "T_MIN", eff)
    for s in config.RATE_STATS:
        product(f"pace_x_{s}_w5", f"{s}_w5_rate", "OPP_ALLOWED_PACE_w10_mean")
        product(f"teampace_x_{s}_w5", f"{s}_w5_rate", "TEAM_PACE_w10_mean")
    # minutes-spike squared (emphasize unusual minutes loads)
    if has("T_MIN") and has("MIN_w5_mean"):
        r = _div(matrix["T_MIN"], matrix["MIN_w5_mean"])
        out["T_x_minutes_spike"] = matrix["T_MIN"].to_numpy(float) * r

    eng = pd.DataFrame(out, index=matrix.index)

    # Drop constant / all-NaN columns; they carry no signal.
    keep = [c for c in eng.columns if eng[c].notna().any() and eng[c].nunique(dropna=True) > 1]
    eng = eng[keep]
    # Drop any accidental name collisions with the base matrix.
    eng = eng[[c for c in eng.columns if c not in cols]]

    print(f"  engineered features added: {eng.shape[1]} "
          f"(base {matrix.shape[1]} -> total {matrix.shape[1] + eng.shape[1]})")
    return pd.concat([matrix, eng], axis=1)
