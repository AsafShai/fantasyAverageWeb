"""Write model_stats_inference/models/<target>.trees.npz from each <target>.joblib.

Serving loads these NumPy twins instead of the scikit-learn pickles, so the web
process never imports scikit-learn or SciPy. Training runs this itself; run it
by hand after replacing a .joblib any other way, then check the result with
scripts/verify_compiled_models.py. Offline: needs scikit-learn.

Usage (from backend/):  python scripts/compile_models.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from model_stats_inference.serving.compiled_model import compile_models  # noqa: E402

MODELS = Path(__file__).resolve().parents[1] / "model_stats_inference" / "models"

if __name__ == "__main__":
    for path in compile_models(MODELS):
        print(f"wrote {path.relative_to(MODELS.parent.parent)}")
