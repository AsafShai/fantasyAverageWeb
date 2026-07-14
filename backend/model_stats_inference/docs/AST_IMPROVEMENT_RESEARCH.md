# AST model improvement research (2026-07-14)

Fourth model in the series ([BLK](BLK_IMPROVEMENT_RESEARCH.md) /
[STL](STL_IMPROVEMENT_RESEARCH.md) / [REB](REB_IMPROVEMENT_RESEARCH.md)):
production rows/filters, 5-fold `KFold(shuffle, random_state=0)`, pooled OOF
metrics on 74,912 rows.

## Baseline (production: `hgb_poisson`, 50 Lasso-selected features)

| RMSE | MAE | R² | PoisDev | Spearman |
|------|-----|----|---------|----------|
| 1.6938 | 1.2438 | 0.5850 | 1.1632 | 0.7368 |

Per-bucket MAE: 0-1 → 0.939 · 2-3 → 1.013 · 4-6 → 1.544 · 7+ → 2.857.
Distribution: mean 2.59, var 6.91, 21.9% zeros, max 23. If-Poisson floor
RMSE ≈ 1.61, max R² ≈ 0.625 (heuristic — assists are role-driven and
overdispersed, like rebounds).

## Experiments (all on identical folds)

| Candidate (hgb_poisson unless noted) | RMSE | MAE | R² | Spearman |
|---|------|-----|----|----------|
| f50 (control) | 1.6938 | 1.2438 | 0.5850 | 0.7368 |
| + AST EWM (hl 5/15 + T_x + share≥5) | 1.6922 | 1.2427 | 0.5858 | 0.7372 |
| + bio/anthro | 1.6937 | 1.2436 | 0.5850 | 0.7372 |
| + ball-dominance ((AST+TOV)/min, FGA/min EWMs) | 1.6929 | 1.2433 | 0.5854 | 0.7372 |
| + years experience / rookie | 1.6937 | 1.2434 | 0.5850 | 0.7370 |
| + EWM + bio | 1.6923 | 1.2426 | 0.5857 | 0.7374 |
| + EWM + ball | 1.6916 | 1.2426 | 0.5860 | 0.7374 |
| + EWM + bio + ball + exp | 1.6913 | 1.2417 | 0.5862 | 0.7377 |
| **shipped: EWM + bio + ball (66 feats)** | **1.6913** | **1.2418** | **0.5862** | **0.7376** |
| LightGBM poisson, f50 | 1.6956 | 1.2421 | 0.5841 | 0.7369 |

Findings:

- **AST EWM is the strongest single group** — assists are the most role/form
  driven of the four stats, exactly where exponential recency shines.
- **Ball-dominance is real, novel signal**: EWM of (AST+TOV) per minute and
  FGA per minute — "who actually runs the offense". First composite-rate
  feature in the engine (`EWM_RATE_COMPOSITES`).
- **Bio is marginal for assists** (as expected — size doesn't create assists)
  but adds calibration polish in combination; it's free (already stored).
- **Experience/rookie: rejected** — ~0.0002 RMSE marginal contribution, and it
  would be the only feature requiring new game-date-dependent inference logic
  plus a bio-artifact schema change. Not worth the surface.
- **LightGBM loses for the fourth time** — architecture question closed.
- Share threshold: P(≥1 assist) is weak (78% of games); `EWM_SHARE_MIN["AST"]
  = 5` marks the playmaker line instead.

## Shipped (2026-07-14)

16 features appended to `training/feature_sets/AST.json` (50 → 66): 5 shared
bio/anthro + `AST_ewm{5,15}_mean`, `AST_ewm{5,15}_rate`,
`T_x_AST_ewm{5,15}_rate`, `AST_share_ewm10`, `AST_share_global` (P≥5) +
`BALLDOM_ewm10_rate`, `T_x_BALLDOM_ewm10_rate`, `FGA_LOAD_ewm10_rate`.
Engine additions: `EWM_STATS` extended with `AST`; new
`EWM_RATE_COMPOSITES` mechanism for composite per-minute EWM rates (computed
from existing AST/TOV/FGA/MIN columns — no new data source).

Validation gate before retraining: production 66-feature set reproduces the
research numbers exactly. Per-bucket after: 0-1 → 0.937 · 2-3 → 1.011 ·
4-6 → 1.546 (+0.002, the outcome-bucket see-saw documented in the STL doc) ·
7+ → 2.850.
