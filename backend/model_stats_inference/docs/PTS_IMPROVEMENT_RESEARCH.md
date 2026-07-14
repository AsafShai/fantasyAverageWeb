# PTS model improvement research (2026-07-14)

Fifth model in the series (BLK / STL / REB / AST docs alongside): production
rows/filters, 5-fold `KFold(shuffle, random_state=0)`, pooled OOF metrics on
74,912 rows. PTS is special: it sits in the reconciler identity
`PTS = 2·FGM + FG3M + FTM`, so shipping a PTS change also rebuilds
`reconciler.joblib` (gains re-estimated from the new OOF residuals).

## Baseline (production: `hgb_poisson`, 50 Lasso-selected features)

| RMSE | MAE | R² | PoisDev | Spearman |
|------|-----|----|---------|----------|
| 5.0116 | 3.7625 | 0.6727 | 2.4331 | 0.8247 |

Per-bucket MAE: 0-5 → 2.948 · 6-10 → 3.084 · 11-20 → 3.795 · 21-30 → 5.437 ·
31+ → 10.063. Distribution: mean 11.13, var 76.7, max 83. The most headroom
of any target (if-Poisson R² ceiling ≈ 0.855): scoring variance is largely
between-game information, not shot noise.

## Experiments (all on identical folds)

| Candidate (hgb_poisson unless noted) | RMSE | MAE | R² | Spearman | 31+ MAE |
|---|------|-----|----|----------|---------|
| f50 (control) | 5.0116 | 3.7625 | 0.6727 | 0.8247 | 10.063 |
| + PTS EWM (hl 5/15 + T_x + share≥20) | 5.0067 | 3.7588 | 0.6733 | 0.8250 | 10.028 |
| + bio/anthro | 5.0094 | 3.7601 | 0.6730 | 0.8249 | 10.014 |
| + usage load ((FGA+0.44·FTA+TOV)/min + T_x + FGA load) | 5.0028 | 3.7567 | 0.6738 | 0.8250 | 9.964 |
| + TS-efficiency form (EWM of per-game TS%) | 5.0091 | 3.7598 | 0.6730 | 0.8250 | 10.009 |
| + EWM + usage | 5.0049 | 3.7570 | 0.6735 | 0.8250 | 9.994 |
| + EWM + TS | 5.0055 | 3.7581 | 0.6735 | 0.8251 | 10.008 |
| + EWM + usage + TS | 5.0035 | 3.7558 | 0.6737 | 0.8251 | 9.991 |
| **+ ALL (EWM + usage + TS + bio) — shipped** | **5.0021** | **3.7555** | **0.6739** | **0.8251** | **9.967** |
| LightGBM poisson, f50 | 5.0041 | 3.7549 | 0.6736 | 0.8253 | 9.887 |

Findings:

- **Every candidate group helps PTS** — the only target in the series where
  all four groups are individually positive; consistent with the large
  theoretical headroom.
- **Usage load is the strongest single group of the entire 5-model research**
  (−0.18% RMSE alone; tail −1%): possession usage is the best scoring signal
  beyond minutes. Second composite-rate feature; the engine now supports
  weighted sums (0.44·FTA).
- **TS-efficiency form** (first ratio composite: EWM of per-game true
  shooting) adds calibration on top.
- **LightGBM is competitive on PTS for the first time** (5.0041, best
  MAE/Spearman/tail) but still loses to HGB+ALL on RMSE/R² and mid-buckets —
  and it is not a production dependency (research-only group). Architecture
  unchanged; noted as the first target worth revisiting if the serving stack
  ever adds LightGBM.

## Shipped (2026-07-14)

17 features appended to `training/feature_sets/PTS.json` (50 → 67): 5 shared
bio/anthro + `PTS_ewm{5,15}_mean/rate` + `T_x_PTS_ewm{5,15}_rate` +
`PTS_share_ewm10`/`PTS_share_global` (P≥20, the 20-point-scorer line) +
`USAGE_LOAD_ewm10_rate`/`T_x_USAGE_LOAD_ewm10_rate`/`FGA_LOAD_ewm10_rate` +
`TS_EFF_ewm10`. Engine additions: weighted composite rates
(`EWM_RATE_COMPOSITES` now maps column→weight) and ratio composites
(`EWM_RATIO_COMPOSITES`, minutes-free). All from existing columns — no new
data source. Validation gate reproduced the research numbers exactly before
retraining; the reconciler was rebuilt from the new OOF residuals.

## Post-ship hypothesis tested: multi-threshold shares

Adding P(≥5) and P(≥10) share features (ewm10 + global each) on top of the
shipped P(≥20): RMSE identical (5.0021), MAE/PoisDev/Spearman microscopically
better (−0.0005 MAE), 31+ tail slightly worse (9.967 → 9.974). The scoring
distribution is already pinned by mean + variance + rate + P(≥20); extra
thresholds are nearly redundant and trade the tail for the body. Rejected —
fails the improve-all-metrics bar.
