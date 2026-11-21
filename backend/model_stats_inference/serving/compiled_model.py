"""The trained models as plain NumPy arrays, so serving never imports scikit-learn.

Production only predicts; the models are scikit-learn HistGradientBoosting
ensembles (Poisson loss, wrapped in ExposureRegressor), and loading their
pickles imports scikit-learn and SciPy: ~50 MB of anonymous memory plus ~25 MB
of shared-library pages for the life of the process. A fitted ensemble is just
trees of (feature, threshold, missing-goes-left, children, leaf value), so
``compile_models`` (offline, needs scikit-learn) writes each ``<target>.joblib``
as ``<target>.trees.npz`` and ``CompiledModel`` evaluates it with NumPy.

Predictions are bit-for-bit those of the scikit-learn objects (see
test_compiled_model.py and scripts/verify_compiled_models.py), by following
scikit-learn's own arithmetic (sklearn/ensemble/_hist_gradient_boosting:
``_raw_predict``, ``_predict_one_from_raw_data``):

* routing: NaN follows ``missing_go_to_left``; otherwise ``x <= threshold`` goes left;
* raw score: start at 0, add the baseline, then each tree's leaf value in
  iteration order (sequential float64 additions, never a pairwise sum);
* Poisson log link: ``exp(raw)``; ExposureRegressor: ``clip(T_MIN, 0) * rate``.

Each .npz records the SHA-256 of the .joblib it was compiled from, so a model
retrained without recompiling is caught (``stale_compiled_models``) instead of
serving the old trees.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import numpy as np

COMPILED_SUFFIX = ".trees.npz"
FORMAT_VERSION = 1


def joblib_sha256(path: Path) -> str:
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


class CompiledModel:
    """One target's ensemble. ``predict`` mirrors the estimator's ``predict``."""

    def __init__(self, arrays: dict[str, np.ndarray], meta: dict):
        self.meta = meta
        self.features: list[str] = meta["features"]
        self.link: str = meta["link"]
        self.exposure_idx: int | None = meta["exposure_idx"]
        self.baseline = float(arrays["baseline"])
        self.feature_idx = arrays["feature_idx"].astype(np.intp)
        self.threshold = arrays["threshold"]
        self.missing_left = arrays["missing_left"]
        self.left = arrays["left"].astype(np.intp)
        self.right = arrays["right"].astype(np.intp)
        self.is_leaf = arrays["is_leaf"]
        self.value = arrays["value"]
        self.roots = arrays["roots"].astype(np.intp)
        # Routing tables where a leaf points at itself, so a row that reached
        # its leaf can keep "stepping" without masks. Children are interleaved
        # (child[2k] left, child[2k + 1] right): one lookup picks the next node.
        leaf = self.is_leaf
        own = np.arange(leaf.size, dtype=np.intp)
        self._child = np.empty(2 * leaf.size, dtype=np.intp)
        self._child[0::2] = np.where(leaf, own, self.left)
        self._child[1::2] = np.where(leaf, own, self.right)
        self._split_feature = np.where(leaf, 0, self.feature_idx)
        depth = np.zeros(leaf.size, dtype=np.intp)
        for i in np.nonzero(~leaf)[0]:  # sklearn stores a parent before its children
            if self.left[i] <= i or self.right[i] <= i:
                raise ValueError("unexpected node order")
            depth[self.left[i]] = depth[self.right[i]] = depth[i] + 1
        # Trees walked deepest first, so each step only touches trees not yet
        # at a leaf; leaf values are still summed in iteration order.
        n_nodes = np.diff(np.append(self.roots, leaf.size))
        tree_depth = np.array([depth[r:r + k].max() for r, k in zip(self.roots, n_nodes)], dtype=np.intp)
        self._walk_order = np.argsort(-tree_depth, kind="stable")
        sorted_depth = tree_depth[self._walk_order]
        self._walking = [int((sorted_depth > d).sum()) for d in range(int(sorted_depth.max(initial=0)))]
        self.max_depth = len(self._walking)

    @classmethod
    def load(cls, path: Path) -> "CompiledModel":
        with np.load(path, allow_pickle=False) as z:
            meta = json.loads(str(z["meta"]))
            if meta.get("format") != FORMAT_VERSION:
                raise ValueError(f"{path}: unsupported compiled-model format {meta.get('format')!r}")
            arrays = {k: z[k] for k in z.files if k != "meta"}
        return cls(arrays, meta)

    def _matrix(self, X) -> np.ndarray:
        columns = getattr(X, "columns", None)
        if columns is not None:
            if list(columns) != self.features:
                raise ValueError("feature columns differ from the ones the model was trained on")
            X = X.to_numpy(dtype=np.float64)
        X = np.asarray(X, dtype=np.float64)
        if X.ndim != 2 or X.shape[1] != len(self.features):
            raise ValueError(f"expected {len(self.features)} feature columns, got shape {X.shape}")
        return X

    def raw_predict(self, X) -> np.ndarray:
        X = np.ascontiguousarray(self._matrix(X))
        n, n_feat = X.shape
        flat = X.reshape(-1)
        row_offset = (np.arange(n, dtype=np.intp) * n_feat)[None, :]
        # node[j, i]: where row i sits in the j-th deepest tree.
        node = np.repeat(self.roots[self._walk_order][:, None], n, axis=1)
        for walking in self._walking:
            at = node[:walking]
            x = flat[row_offset + self._split_feature[at]]
            # NaN compares False, so it goes right unless missing_go_to_left.
            go_right = ~((x <= self.threshold[at]) | (np.isnan(x) & self.missing_left[at]))
            node[:walking] = self._child[2 * at + go_right]
        leaf_values = np.empty_like(node, dtype=np.float64)
        leaf_values[self._walk_order] = self.value[node]  # back to iteration order
        raw = np.zeros(n, dtype=np.float64)
        raw += self.baseline
        for t in range(leaf_values.shape[0]):  # sequential, in iteration order
            raw += leaf_values[t]
        return raw

    def predict(self, X) -> np.ndarray:
        X = self._matrix(X)
        raw = self.raw_predict(X)
        if self.link == "log":
            out = np.exp(raw)
        elif self.link == "identity":
            out = raw
        else:
            raise ValueError(f"unknown link {self.link!r}")
        if self.exposure_idx is not None:
            out = np.clip(X[:, self.exposure_idx], 0.0, None) * out
        return out


def load_compiled_payload(path: Path) -> dict:
    """The serving payload (target, features, model, clip_at_zero, metrics,
    model_name) the .joblib held, with ``model`` a CompiledModel."""
    model = CompiledModel.load(path)
    meta = model.meta
    return {
        "target": meta["target"],
        "features": meta["features"],
        "model": model,
        "model_name": meta.get("model_name"),
        "clip_at_zero": meta.get("clip_at_zero", True),
        "metrics": meta.get("metrics", {}),
    }


# --- offline: compile (needs scikit-learn) --------------------------------------


def _compile_estimator(model, features: list[str]) -> tuple[dict[str, np.ndarray], dict]:
    from sklearn.ensemble import HistGradientBoostingRegressor  # offline only

    exposure_idx = None
    hgb = model
    if type(model).__name__ == "ExposureRegressor":
        exposure_idx = features.index(model.exposure_col)
        hgb = model.base_
    if not isinstance(hgb, HistGradientBoostingRegressor):
        raise TypeError(f"cannot compile {type(hgb).__name__}")
    if list(hgb.feature_names_in_) != list(features):
        raise ValueError("estimator feature order differs from the payload's features")
    if hgb.n_trees_per_iteration_ != 1:
        raise ValueError("only single-output ensembles are supported")
    if getattr(hgb, "is_categorical_", None) is not None and hgb.is_categorical_.any():
        raise ValueError("categorical splits are not supported")
    link = {"LogLink": "log", "IdentityLink": "identity"}.get(type(hgb._loss.link).__name__)
    if link is None:
        raise ValueError(f"unsupported link {type(hgb._loss.link).__name__}")

    parts = {k: [] for k in ("feature_idx", "threshold", "missing_left", "left", "right", "is_leaf", "value")}
    roots = []
    offset = 0
    for iteration in hgb._predictors:
        (tree,) = iteration
        nodes = tree.nodes
        if nodes["is_categorical"].any():
            raise ValueError("categorical splits are not supported")
        roots.append(offset)
        parts["feature_idx"].append(nodes["feature_idx"].astype(np.int32))
        parts["threshold"].append(nodes["num_threshold"].astype(np.float64))
        parts["missing_left"].append(nodes["missing_go_to_left"].astype(bool))
        parts["left"].append(nodes["left"].astype(np.int64) + offset)
        parts["right"].append(nodes["right"].astype(np.int64) + offset)
        parts["is_leaf"].append(nodes["is_leaf"].astype(bool))
        parts["value"].append(nodes["value"].astype(np.float64))
        offset += len(nodes)
    arrays = {k: np.concatenate(v) for k, v in parts.items()}
    arrays["roots"] = np.asarray(roots, dtype=np.int64)
    baseline = np.asarray(hgb._baseline_prediction, dtype=np.float64).reshape(-1)
    if baseline.size != 1:
        raise ValueError("expected one baseline value")
    arrays["baseline"] = baseline[0]
    meta = {"link": link, "exposure_idx": exposure_idx}
    return arrays, meta


def compile_models(models_dir: Path) -> list[Path]:
    """Write ``<target>.trees.npz`` next to every ``<target>.joblib``."""
    import joblib  # offline only

    written = []
    for path in sorted(Path(models_dir).glob("*.joblib")):
        if path.name == "reconciler.joblib":
            continue
        payload = joblib.load(path)
        arrays, meta = _compile_estimator(payload["model"], list(payload["features"]))
        meta.update(
            format=FORMAT_VERSION,
            target=payload["target"],
            features=list(payload["features"]),
            model_name=payload.get("model_name"),
            clip_at_zero=bool(payload.get("clip_at_zero", True)),
            metrics=payload.get("metrics", {}),
            source=path.name,
            source_sha256=joblib_sha256(path),
        )
        out = path.with_name(path.stem + COMPILED_SUFFIX)
        np.savez(out, meta=np.asarray(json.dumps(meta, sort_keys=True)), **arrays)
        written.append(out)
    return written


def stale_compiled_models(models_dir: Path) -> list[str]:
    """Targets whose .joblib has no compiled twin or changed since it was compiled."""
    stale = []
    for path in sorted(Path(models_dir).glob("*.joblib")):
        if path.name == "reconciler.joblib":
            continue
        compiled = path.with_name(path.stem + COMPILED_SUFFIX)
        if not compiled.exists():
            stale.append(path.stem)
            continue
        with np.load(compiled, allow_pickle=False) as z:
            meta = json.loads(str(z["meta"]))
        if meta.get("source_sha256") != joblib_sha256(path):
            stale.append(path.stem)
    return stale
