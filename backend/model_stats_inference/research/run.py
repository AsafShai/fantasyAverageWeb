"""End-to-end feature research pipeline: load -> features -> select -> plot.

    uv run python -m model_stats_inference.research.run            # use cached data
    uv run python -m model_stats_inference.research.run --refresh  # re-pull nba_api
"""

from __future__ import annotations

import argparse
import json

from . import config, data, features, plots, selection


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--refresh", action="store_true", help="re-pull from nba_api")
    args = parser.parse_args()

    players, team_allowed, team_own = data.load_or_build(refresh=args.refresh)
    matrix = features.build_feature_matrix(players, team_allowed, team_own)

    # Persist the full matrix so the training step can load X/y directly.
    matrix_path = config.DATA_DIR / "feature_matrix.parquet"
    matrix.to_parquet(matrix_path, index=False)
    print(f"Feature matrix saved -> {matrix_path}")

    results = selection.run_selection(matrix)
    plots.make_plots(results)

    # Training bridge: target -> selected feature names.
    config.OUTPUT_DIR.mkdir(exist_ok=True)
    selected = {t: res.selected["feature"].tolist() for t, res in results.items()}
    with open(config.OUTPUT_DIR / "selected_features.json", "w") as f:
        json.dump(selected, f, indent=2)

    print("\nDone. See outputs/ for selected_*.csv, selected_features.json, *.png, summary.csv")


if __name__ == "__main__":
    main()
