"""Check model_stats_inference/models/*.trees.npz against the scikit-learn
models they were compiled from: every prediction must be bit-for-bit equal.

Offline (needs scikit-learn). Rows are built to hit every split boundary:
each feature takes its split thresholds, the floats just above and below
them, NaN, +-inf, zero, negatives and random values; T_MIN includes 0 and
negative minutes (the exposure clip).

Usage (from backend/):  python scripts/verify_compiled_models.py [--rows 200000]
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from model_stats_inference.serving.compiled_model import (  # noqa: E402
    COMPILED_SUFFIX, CompiledModel, stale_compiled_models,
)

MODELS = Path(__file__).resolve().parents[1] / "model_stats_inference" / "models"


def boundary_rows(model: CompiledModel, n_rows: int, rng: np.random.Generator) -> np.ndarray:
    n_feat = len(model.features)
    split = ~model.is_leaf
    columns = []
    for f in range(n_feat):
        thr = model.threshold[split & (model.feature_idx == f)]
        thr = thr[np.isfinite(thr)]
        pool = [np.array([np.nan, np.inf, -np.inf, 0.0, -1.0, 1e9, -1e9])]
        if thr.size:
            pool += [thr, np.nextafter(thr, np.inf), np.nextafter(thr, -np.inf),
                     rng.uniform(thr.min() - 1, thr.max() + 1, 64)]
        else:
            pool.append(rng.normal(0, 10, 64))
        pool = np.concatenate(pool)
        columns.append(rng.choice(pool, n_rows))
    X = np.column_stack(columns)
    if model.exposure_idx is not None:
        X[: n_rows // 20, model.exposure_idx] = 0.0
        X[n_rows // 20: n_rows // 10, model.exposure_idx] = -3.0
    return X


def same(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    return (a.view(np.int64) == b.view(np.int64)) | (np.isnan(a) & np.isnan(b))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--rows", type=int, default=200_000)
    args = parser.parse_args()
    stale = stale_compiled_models(MODELS)
    if stale:
        print(f"STALE or missing compiled models: {stale} (run scripts/compile_models.py)")
        return 1
    rng = np.random.default_rng(0)
    failed = False
    for path in sorted(MODELS.glob(f"*{COMPILED_SUFFIX}")):
        compiled = CompiledModel.load(path)
        payload = joblib.load(path.with_name(path.name.replace(COMPILED_SUFFIX, ".joblib")))
        X = boundary_rows(compiled, args.rows, rng)
        df = pd.DataFrame(X, columns=compiled.features)
        ours, theirs = compiled.predict(df), payload["model"].predict(df)
        ok = same(ours, theirs)
        hgb = getattr(payload["model"], "base_", payload["model"])
        raw_ok = same(compiled.raw_predict(df), hgb._raw_predict(df).ravel())
        print(f"{compiled.meta['target']:5s} rows={len(X):,} trees={compiled.roots.size} "
              f"predict identical={ok.all()} ({(~ok).sum()} differ)  raw identical={raw_ok.all()}")
        failed |= not (ok.all() and raw_ok.all())
    print("FAILED" if failed else "OK: every compiled model matches scikit-learn bit for bit")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
