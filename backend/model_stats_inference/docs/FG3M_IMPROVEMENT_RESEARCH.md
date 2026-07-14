# FG3M model improvement research (2026-07-15)

The last of the ten models (BLK / STL / REB / AST / PTS / FG / FT docs
alongside). Production rows/filters, 5-fold `KFold(shuffle, random_state=0)`,
pooled OOF metrics on 74,912 rows. FG3M is in the reconciler block, so
shipping rebuilds `reconciler.joblib`.

## Baseline (production: `hgb_poisson`, 50 Lasso-selected features)

| RMSE | MAE | R² | PoisDev | Spearman |
|------|-----|----|---------|----------|
| 1.1582 | 0.8222 | 0.4173 | 1.0000 | 0.6726 |

Distribution: mean 1.29, var 2.30, 41% zeros, 9.2% of games ≥4 makes.

## Experiments (all on identical folds)

| Candidate | RMSE | MAE | R² | Spearman |
|---|------|-----|----|----------|
| f50 (control) | 1.1582 | 0.8222 | 0.4173 | 0.6726 |
| + FG3M EWM (hl 5/15 + T_x + share≥4) | 1.1570 | 0.8217 | 0.4186 | 0.6733 |
| + 3PT%-form + shot-diet | 1.1579 | 0.8223 | 0.4177 | 0.6727 |
| + FG3A load (attempt volume/min + T_x) | 1.1574 | 0.8214 | 0.4182 | 0.6726 |
| + usage/TS | 1.1580 | 0.8222 | 0.4176 | 0.6727 |
| + bio/anthro | 1.1580 | 0.8220 | 0.4176 | 0.6725 |
| + rival 3PT defense (allowed FG3A) | 1.1584 | 0.8220 | 0.4172 | 0.6725 |
| + core (EWM+form+load+usage+bio) | 1.1571 | 0.8212 | 0.4185 | 0.6729 |
| + core + rival 3PT defense | 1.1561 | 0.8205 | 0.4195 | 0.6736 |
| LightGBM poisson, f50 | 1.1583 | 0.8182 | 0.4173 | 0.6728 |

Tail round (fine buckets, on top of core):

| Candidate | RMSE | R² | 6+ MAE |
|---|------|----|--------|
| core (base) | 1.1571 | 0.4185 | 3.756 |
| **+ multi-shares P(≥2)/P(≥3) (shipped)** | **1.1569** | **0.4187** | 3.756 |
| + recent ceiling (w10 max, w20 p90) | 1.1571 | 0.4185 | 3.759 |
| + hot-streak length | 1.1570 | 0.4186 | 3.762 |
| + all of the above | 1.1568 | 0.4188 | 3.759 |

Findings:

- **EWM is the workhorse again** (threes are streaky/form-driven); the ≥4
  share marks the hot-night line, and the P(≥2)/P(≥3) multi-shares add the
  coarse-CDF shape (bimodal shooters vs non-shooters — same mechanism that
  won the FT tail round).
- **Rival 3PT defense (allowed FG3A) improves the model further (1.1561) but
  is migration-gated**: `fs_team_games` has no `fg3a` column. This is the
  cheapest of the three documented migration-gated wins (single column +
  backfill, no new pipeline; the others: REB opponent-environment, FGA zone
  defense). First candidate if that table ever grows columns.
- The all-tail stack (1.1568) edges the shipped set by 0.0001 RMSE but needs
  three new engine mechanisms (rolling max, quantile, streak) — not worth it.
- **LightGBM loses (8th and final architecture confirmation).**

## Shipped (2026-07-15)

`FG3M.json`: 50 → **75** (FG3M EWM 8, FG3_FORM + SHOT_DIET3 2, FG3A_LOAD +
T_x 2, usage/TS 4, bio 5, multi-shares 4). Engine: `EWM_STATS` + FG3M
(share ≥4, extra [2, 3]); `EWM_RATIO_COMPOSITES` + FG3_FORM;
`EWM_RATE_COMPOSITES` + FG3A_LOAD. No new data source, no migration.
Reconciler rebuilt; validation gate reproduced the research number exactly
(RMSE 1.1569).

Final vs production: RMSE 1.1582 → **1.1569** (−0.11%), MAE 0.8222 →
**0.8213**, R² 0.4173 → **0.4187**, Spearman 0.6726 → **0.6730**.

**This completes the series: all 10 per-stat models improved.**
