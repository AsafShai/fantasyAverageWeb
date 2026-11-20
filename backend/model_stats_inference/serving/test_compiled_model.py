"""The compiled (NumPy) models must predict exactly what the scikit-learn models do,
and production must never import scikit-learn or SciPy.

The full boundary sweep (200k rows a model) is scripts/verify_compiled_models.py;
this runs a smaller one on every test run.
"""

import os
import subprocess
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from model_stats_inference.serving import config
from model_stats_inference.serving.compiled_model import (
    COMPILED_SUFFIX, CompiledModel, stale_compiled_models,
)
from model_stats_inference.serving.inference import LiveInference

joblib = pytest.importorskip("joblib")
pytest.importorskip("sklearn")

BACKEND = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(BACKEND / "scripts"))
from verify_compiled_models import boundary_rows, same  # noqa: E402


def test_production_models_are_compiled_and_current():
    assert stale_compiled_models(config.MODELS_DIR) == []


@pytest.mark.parametrize("path", sorted(config.MODELS_DIR.glob(f"*{COMPILED_SUFFIX}")), ids=lambda p: p.name)
def test_production_model_matches_sklearn_bit_for_bit(path):
    compiled = CompiledModel.load(path)
    payload = joblib.load(path.with_name(path.name.replace(COMPILED_SUFFIX, ".joblib")))
    X = pd.DataFrame(boundary_rows(compiled, 5_000, np.random.default_rng(7)), columns=compiled.features)
    assert same(compiled.predict(X), payload["model"].predict(X)).all()
    # A plain ndarray in the model's column order is what inference passes.
    assert same(compiled.predict(X.to_numpy()), payload["model"].predict(X)).all()


def test_compiled_model_refuses_misordered_columns():
    path = next(config.MODELS_DIR.glob(f"*{COMPILED_SUFFIX}"))
    compiled = CompiledModel.load(path)
    X = pd.DataFrame(np.zeros((2, len(compiled.features))), columns=compiled.features)
    with pytest.raises(ValueError):
        compiled.predict(X[list(reversed(compiled.features))])


class _SklearnModel:
    """The pre-compilation serving path: the pickled estimator fed a named DataFrame."""

    def __init__(self, model, features):
        self.model, self.features = model, features

    def predict(self, X):
        return self.model.predict(pd.DataFrame(X, columns=self.features))


def test_live_inference_identical_to_sklearn_serving(store, models_dir):
    """Every stat of every player through the whole serving path (feature row
    assembly, clip, MinT reconciliation, percentages): compiled == scikit-learn."""
    from model_stats_inference.serving.inference import PredictionRequest

    compiled = LiveInference(store, models_dir=models_dir)
    reference = LiveInference(store, models_dir=models_dir)
    for target, payload in reference.models.items():
        model = joblib.load(models_dir / f"{target}.joblib")["model"]
        payload["model"] = _SklearnModel(model, payload["features"])

    team_ids = sorted(int(t) for t in store.team_own_vectors.index.unique())
    reqs = [
        PredictionRequest(player_id=pid, opponent_team_id=team_ids[i % len(team_ids)],
                          is_home=bool(i % 2), game_date=pd.Timestamp("2026-01-15"), minutes=minutes)
        for i, pid in enumerate(sorted(int(p) for p in store.players["PLAYER_ID"].unique()))
        for minutes in (0.0, 12.5, 30.0, 44.0)
    ]
    got, got_err = compiled.predict_many(reqs)
    want, want_err = reference.predict_many(reqs)
    assert [type(e) for e in got_err] == [type(e) for e in want_err]
    compared = 0
    for g, w in zip(got, want):
        assert (g is None) == (w is None)
        if g is None:
            continue
        assert g.stats.keys() == w.stats.keys()
        for stat in g.stats:
            for field in ("value", "low", "high"):
                a, b = getattr(g.stats[stat], field), getattr(w.stats[stat], field)
                assert (a is None and b is None) or same(np.float64(a), np.float64(b))
        compared += 1
    assert compared > 0


def test_production_process_never_imports_sklearn_or_scipy():
    code = (
        "import sys\n"
        "from unittest.mock import MagicMock\n"
        "import numpy as np, pandas as pd\n"
        "import app.main\n"
        "from model_stats_inference.serving.inference import LiveInference\n"
        "inf = LiveInference(MagicMock())\n"
        "for p in inf.models.values(): p['model'].predict(np.zeros((2, len(p['features']))))\n"
        "from model_stats_inference.serving import surprise\n"
        "surprise.to_standard_normal_with(pd.Series([0.5, 1.5]), [0.0, 1.0, 2.0], 3)\n"
        "bad = sorted({m.split('.')[0] for m in sys.modules if m.split('.')[0] in ('sklearn', 'scipy')})\n"
        "print('LOADED:' + ','.join(bad))\n"
    )
    out = subprocess.run([sys.executable, "-c", code], cwd=BACKEND, capture_output=True, text=True,
                         env={**os.environ, "PYTHONPATH": str(BACKEND)}, timeout=300)
    assert "LOADED:" in out.stdout, out.stderr[-2000:]
    assert out.stdout.strip().splitlines()[-1] == "LOADED:"
