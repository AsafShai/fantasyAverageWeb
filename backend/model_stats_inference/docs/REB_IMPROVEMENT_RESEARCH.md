# REB model improvement research (2026-07-14)

Same research loop as [BLK](BLK_IMPROVEMENT_RESEARCH.md) /
[STL](STL_IMPROVEMENT_RESEARCH.md): production rows/filters, 5-fold
`KFold(shuffle, random_state=0)`, pooled OOF metrics on 74,912 rows.

## Baseline (production: `hgb_poisson`, 50 Lasso-selected features)

| RMSE | MAE | R² | PoisDev | Spearman |
|------|-----|----|---------|----------|
| 2.1582 | 1.6306 | 0.5979 | 1.1520 | 0.7490 |

Per-bucket MAE: 0-3 → 1.323 · 4-5 → 1.276 · 6-10 → 2.094 · 11+ → 3.759
(11+ games are under-predicted by 3.5 boards on average — regression to the
mean on a heavy-tailed stat).

Distribution: mean 4.24, var 11.58, 8.8% zeros, max 31. Rebounds are NOT
Poisson (opportunity-share process, overdispersed marginally), so the naive
Poisson "ceiling" (R² ≈ 0.63) is a heuristic, not a wall — but in practice the
experiments below found the same saturation as BLK/STL.

## Experiments (all on identical folds)

| Candidate (hgb_poisson unless noted) | RMSE | MAE | R² | Spearman | 11+ MAE |
|---|------|-----|----|----------|---------|
| f50 (control) | 2.1582 | 1.6306 | 0.5979 | 0.7490 | 3.759 |
| + REB EWM (hl 5/15 + T_x + share≥6) | 2.1581 | 1.6307 | 0.5979 | 0.7492 | 3.762 |
| + bio/anthro | 2.1566 | 1.6292 | 0.5985 | 0.7495 | 3.752 |
| **+ EWM + bio (shipped)** | **2.1566** | **1.6293** | **0.5985** | **0.7496** | 3.758 |
| + opponent reb environment (OREB/DREB/misses/3PA/pace, 30) | 2.1588 | 1.6312 | 0.5977 | 0.7489 | 3.762 |
| + own-team misses/boards (30) | 2.1592 | 1.6316 | 0.5975 | 0.7487 | 3.764 |
| + EWM + bio + opp environment | 2.1555 | 1.6291 | 0.5989 | 0.7496 | 3.755 |
| OREB + DREB decomposition (two models, summed) | 2.1601 | 1.6316 | 0.5972 | 0.7486 | 3.783 |
| LightGBM poisson, f50 | 2.1604 | 1.6310 | 0.5971 | 0.7486 | 3.764 |

Findings:

- **Bio/anthro is the strongest group of the whole 3-model research arc** —
  rebounds are the most size-driven stat; height/wingspan/reach carry real
  signal beyond the position flags.
- **EWM adds calibration polish** on PoisDev/Spearman on top of bio.
- **Opponent rebounding environment genuinely helps** (best config overall at
  2.1555) **but was rejected on cost/benefit**: its inputs (per-game OREB/
  DREB/FGM/FG3A of the opponent) are not stored in `fs_team_games`, so serving
  it requires a DB schema migration + full backfill for an extra −0.05% RMSE.
  Documented here as the first candidate to revisit if the table ever gains
  those columns.
- **OREB+DREB decomposition loses to the direct model** — the two models'
  errors add rather than cancel (they share the same minutes/role drivers),
  and the tail (11+) gets notably worse. Not shipped.
- **LightGBM loses again** — architecture unchanged.

## Shipped (2026-07-14)

13 features appended to `training/feature_sets/REB.json` (50 → 63): the 5
shared bio/anthro columns + `REB_ewm{5,15}_mean`, `REB_ewm{5,15}_rate`,
`T_x_REB_ewm{5,15}_rate`, `REB_share_ewm10`, `REB_share_global`. The share
threshold is per-stat now (`EWM_SHARE_MIN`): P(≥1) is meaningless for rebounds
(91% of games), so REB's share features count **P(≥6 boards)** — the
board-crasher line. `EWM_STATS` extended to `["BLK", "STL", "REB"]`.
