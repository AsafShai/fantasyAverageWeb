# Per-stat next-game prediction — feature research

Builds a large, leakage-safe feature set (~250 features) from 3 seasons of NBA
game logs and uses **LassoCV** to select the best ~50 features for each target
stat. Output: selected feature lists + plots, so we can see which features matter
before training final estimators.

Model goal (downstream): `Y = F(X, t)` — predict a player's next-game stat from
engineered features `X` and the minutes `t` they will play. One model per stat.

## Run

```bash
cd backend
# first run pulls from nba_api and caches to research/data/*.parquet
uv run python -m model_stats_inference.research.run --refresh
# subsequent runs reuse the cache
uv run python -m model_stats_inference.research.run
```

Tests (windowing / no-leakage):

```bash
PYTHONPATH=. uv run pytest model_stats_inference/research/test_features.py
```

## Targets

`PTS, REB, AST, FG3M, STL, BLK` directly. **FG%** and **FT%** are modeled via their
components `FGM/FGA` and `FTM/FTA` and derived as makes/attempts downstream.

## Features (~200, all leakage-safe)

Every history feature for a player-game uses only games **before** that game.

- **Player history** per base stat (`PTS, REB, OREB, DREB, AST, FG3M, FG3A, STL,
  BLK, TOV, FGM, FGA, FTM, FTA, MIN, PF, PLUS_MINUS`):
  - `global` (all prior games), `w10` (last 10, ≤60 days), `w5` (last 5, ≤30 days)
  - `_mean`, `_var`, and `_rate = sum(stat)/sum(MIN)` (counting stats only)
- **Minutes-scaled (most important):** `T_MIN` (= `t`) and `T_x_<stat>_<window>_rate`
  (`t * rate`).
- **Shooting efficiency:** `FG_EFF`, `FG3_EFF`, `FT_EFF` per window (= makes/attempts
  over the window, not noisy per-game %).
- **Own-team offensive context:** `TEAM_PACE` and `TEAM_PTS/REB/AST/FG3M/FG_PCT` over
  the player's own team's prior games, `global`/`w10`/`w5` mean & var.
- **Opponent ("rival") allowed:** how much the opponent team gives up
  (`OPP_ALLOWED_PTS/REB/AST/STL/BLK/FG3M/FG_PCT/PACE`) over their prior games,
  `global`/`w10`/`w5` mean & var.
- **Position (multi-hot):** `IS_GUARD`, `IS_FORWARD`, `IS_CENTER` (hybrids set two).
- **Context:** `IS_HOME`, `REST_DAYS`, `IS_BACK_TO_BACK`, `HISTORY_GAMES`.

All features are **z-scored** (`StandardScaler`) before Lasso, so coefficients are
directly comparable.

`run.py` also writes `data/feature_matrix.parquet` (full X+y, the training bridge)
and `outputs/selected_features.json` (target -> selected feature names).

## Filters (applied in `data.py` / `config.py`)

- Regular season only (no playoffs / play-in / preseason / all-star).
- Drop games with `MIN < 2` entirely (DNP / garbage time) — not targets, not history.
- Drop players with `< 20` qualifying games.
- Train only on rows with `>= 1` prior game (configurable `MIN_HISTORY_GAMES`);
  inference is supported at any history depth.

## Files

| file | role |
|------|------|
| `config.py` | all knobs: seasons, windows, filters, stat/target lists |
| `data.py` | fetch + filter logs, build opponent allowed table, cache parquet |
| `features.py` | leakage-safe windowing engine + feature assembly |
| `selection.py` | LassoCV per target, chronological holdout metrics |
| `plots.py` | selected-feature bars, alpha path, predicted-vs-actual, overview |
| `run.py` | orchestrates the whole pipeline |

## Outputs (`outputs/`)

- `selected_<target>.csv` — the ~30 chosen features + coefficients
- `summary.csv` — per-target alpha, MAE vs baseline, R²
- `selected_<target>.png`, `path_<target>.png`, `fit_<target>.png`, `overview.png`
