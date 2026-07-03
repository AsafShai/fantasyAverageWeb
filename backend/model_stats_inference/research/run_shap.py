"""Run the SHAP feature-research pipeline (does NOT touch production feature sets).

    uv run python -m model_stats_inference.research.run_shap

Loads cached data → builds the base matrix → adds ~270 engineered ratio/product
features → SHAP-ranks and selects per target, validated on a held-out TEST split.
Writes outputs/selected_features_shap.json + outputs/shap_summary.csv for comparison.
"""

from __future__ import annotations

from . import data, engineered, features, shap_select


def main() -> None:
    players, team_allowed, team_own = data.load_or_build(refresh=False)
    matrix = features.build_feature_matrix(players, team_allowed, team_own)
    matrix = engineered.add_engineered_features(matrix)
    shap_select.run_shap_selection(matrix)


if __name__ == "__main__":
    main()
