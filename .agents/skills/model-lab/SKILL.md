---
name: model-lab
description: Work on the per-stat next-game prediction ML pipeline (model_stats_inference). Use when touching research, feature selection, training, serving, the feature store, reconciliation, or the simulation harness — or when the user says "model lab", "retrain", "model metrics", "predictions look wrong".
---

# Model Lab — model_stats_inference

One model per stat predicting next-game lines: `Y = F(X, t)` where `t` = expected minutes. Lives in `backend/model_stats_inference/`. Branch: `feature/model-stats-inference` (PR #100) until merged.

## Read first (in this order, only what the task needs)

1. `research/README.md` — feature engineering + LassoCV selection (~250 → ~50 features per stat)
2. `serving/README.md` — feature store (design b2) + live inference
3. `docs/RECONCILIATION.md` — MinT coherent shooting lines
4. `models/model_card.json` — current metrics per stat

## Pipeline map

```
research/   ~250 leakage-safe features from 3 seasons (nba_api → parquet cache)
            LassoCV selects ~50/stat → research/outputs/selected_<STAT>.csv
            SHAP alternative: run_shap.py → shap_select.py
training/   feature_sets/<STAT>.json + estimator registry (models.py)
            production model: MODEL_NAME in training/config.py (currently hgb_poisson)
            compare_models.py = bake-off across registry
            output: models/*.joblib + models/model_card.json
serving/    FeatureStore (raw rows = source of truth, vectors recomputed on update)
            LiveInference.predict(player, opponent, is_home, date, minutes)
            reconcile.py = MinT on [PTS, FGM, FG3M, FTM, FGA, FTA]
app/        routes/simulation.py + services/simulation_service.py + pages/Simulation.tsx
            = season-replay DEBUG harness (eval loop), not prod serving
```

## Commands (from `backend/`)

```bash
uv run python -m model_stats_inference.research.run            # feature build (cached)
uv run python -m model_stats_inference.research.run --refresh  # re-pull nba_api
PYTHONPATH=. uv run pytest model_stats_inference/research/test_features.py  # leakage tests
uv run pytest model_stats_inference/serving/                   # hermetic serving tests
PYTHONPATH=. uv run python scripts/check_model_regression.py   # metric gate vs last commit
```

## Invariants — do not break

- **Leakage safety:** every history feature for a player-game uses only games strictly BEFORE that game. `research/test_features.py` locks this. Any new feature must pass it.
- **Targets:** `PTS, REB, AST, FG3M, STL, BLK` direct; FG%/FT% via components `FGM/FGA/FTM/FTA`, derived downstream. Never model percentages directly.
- **Scoring identity:** `PTS = 2·FGM + FG3M + FTM` (FG3M coefficient is +1 — a made three already counts in FGM). MinT reconciles the shooting block only; REB/AST/STL/BLK pass through.
- **Minutes are an input, not a feature to predict.** `T_MIN` and `t×rate` features recompute at predict time; user-supplied `t` must change the line.
- **`InsufficientHistoryError`** for players with `< MIN_INFERENCE_GAMES` (10) — never return garbage lines for rookies/just-traded.
- **Production feature store** builds from UNFILTERED logs, not the research cache (research drops <20-game players).
- Model family swap = one line: `MODEL_NAME` in `training/config.py` (registry in `training/models.py`). Add candidates to the registry, don't fork the training loop.

## Retrain / update flow (target architecture — agreed 2026-07-03)

- Train once offline on historic data; artifacts in `models/*.joblib` + `model_card.json`.
- Nightly (planned): fetch last night's results → per-player DB rows → `FeatureStore.update_with_nightly_results()` → save. Vectors stay fresh; full retrain is occasional, not nightly.
- After ANY retrain: run the regression gate (`scripts/check_model_regression.py`) — fails if a stat's RMSE worsens >2% vs the committed model_card. Then commit model_card.json with the new numbers.

## Reading model_card.json

Per stat: `rmse_mean` (CV), `baseline_rmse` (naive baseline — must beat it clearly), `r2_mean`, `resid_sigma`/`resid_bias` (residual spread/skew for the ±band). Current reference points: PTS rmse ~5.01 vs baseline 8.76 (r² 0.67), REB ~2.16 vs 3.40, AST ~1.69 vs 2.63, FG3M ~1.16 vs 1.52.

## Deploy warning

`app/main.py` imports the simulation route → imports this package. Docker image currently copies only `app/` → merging as-is crashes prod. See `docs/plans/MODEL_DEPLOYMENT_ISSUES.md` before merging PR #100.

## Eval loop

Use the simulation harness (`/api/simulation` + Simulation page): init a season → step days → compare predicted vs actual with the eval coloring. Prefer it over ad-hoc scripts for "is the model better now" questions.
