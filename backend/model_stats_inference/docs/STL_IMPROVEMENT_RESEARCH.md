# STL model improvement research (2026-07-14)

Same research loop as [BLK](BLK_IMPROVEMENT_RESEARCH.md), same protocol
throughout: production rows/filters, 5-fold `KFold(shuffle, random_state=0)`,
pooled out-of-fold metrics on 74,912 rows.

## Baseline (production: `hgb_poisson`, 50 Lasso-selected features)

| RMSE | MAE | R² | PoisDev | Spearman | MAE (STL≥2) |
|------|-----|----|---------|----------|-------------|
| 0.8969 | 0.6868 | 0.1654 | 1.0558 | 0.3984 | 1.4018 |

## Ceiling: steals are the noisiest stat in the sheet

Single-game steals ≈ Poisson around the player's true rate. With
`mean(STL) = 0.778`, `var(STL) = 0.964`:

- irreducible variance = 0.778 → noise-floor RMSE ≈ **0.882**
- **maximum achievable R² ≈ 0.193**

Baseline R² 0.165 already captures **~86% of the explainable variance** —
even more saturated than BLK was (81%). Honest headroom ≈ 1.7% RMSE.

## Experiments (all on identical folds)

| Candidate (hgb_poisson unless noted) | RMSE | MAE | R² | Spearman | MAE (STL≥2) |
|---|------|-----|----|----------|-------------|
| f50 (control) | 0.8969 | 0.6868 | 0.1654 | 0.3984 | 1.4018 |
| + STL EWM (hl 5/15 mean/rate + T_x + share) | 0.8967 | 0.6866 | 0.1656 | 0.3985 | 1.4017 |
| + bio/anthro (height/weight/wingspan/reach) | 0.8967 | 0.6866 | 0.1657 | 0.3992 | 1.3998 |
| + opponent TOV/pace/AST history | 0.8972 | 0.6871 | 0.1647 | 0.3984 | 1.4027 |
| + matchup (player vs this opponent) | 0.8970 | 0.6870 | 0.1651 | 0.3978 | 1.4015 |
| **+ EWM + bio (shipped)** | **0.8962** | **0.6863** | **0.1665** | **0.3996** | **1.3995** |
| + EWM + bio + opptov + matchup | 0.8964 | 0.6865 | 0.1662 | 0.3994 | 1.4015 |
| LightGBM poisson, f50 | 0.8995 | 0.6851 | 0.1605 | 0.3946 | 1.4111 |
| LightGBM poisson, f50+EWM+bio | 0.8984 | 0.6841 | 0.1625 | 0.3969 | 1.4081 |

Findings mirror BLK exactly:

- **Architecture unchanged** — LightGBM loses on RMSE/R²/tail both times; its
  lower MAE is the predict-more-zeros artifact.
- **Opponent-turnover and matchup features are noise** (steal opportunities are
  already priced in via `OPP_ALLOWED_STL_*`); excluded from the ship set.
- **EWM + physical profile is the only combination that improves every
  metric**, same recipe that shipped for BLK. Bio columns are shared with the
  BLK work — zero additional storage or fetching for them.

## Shipped (2026-07-14)

13 features appended to `training/feature_sets/STL.json` (50 → 63): the 5
shared bio/anthro columns + `STL_ewm{5,15}_mean`, `STL_ewm{5,15}_rate`,
`T_x_STL_ewm{5,15}_rate`, `STL_share_ewm10`, `STL_share_global` (computed from
existing STL/MIN columns — no new data source). `EWM_STATS` in
`research/config.py` generalized from `["BLK"]` to `["BLK", "STL"]`.
