# FTM + FTA model improvement research (2026-07-14)

Seventh and final round of the series (BLK / STL / REB / AST / PTS / FG docs
alongside) — the free-throw pair. Production rows/filters, 5-fold
`KFold(shuffle, random_state=0)`, pooled OOF metrics on 74,912 rows. Both
targets sit in the reconciler block, so shipping rebuilds `reconciler.joblib`.

## Baselines (production: `hgb_poisson`, 50 features each)

| Target | RMSE | MAE | R² | PoisDev | Spearman |
|--------|------|-----|----|---------|----------|
| FTA | 2.1065 | 1.5311 | 0.4362 | 2.0088 | 0.6115 |
| FTM | 1.7869 | 1.2744 | 0.4197 | 1.7389 | 0.5962 |

Free throws are event-driven (43-46% of games have zero attempts) — closer to
the BLK/STL noise regime than to PTS/FGA.

## Experiments (all on identical folds)

### FTA

| Candidate | RMSE | MAE | R² | Spearman | 6+ MAE |
|---|------|-----|----|----------|--------|
| f50 (control) | 2.1065 | 1.5311 | 0.4362 | 0.6115 | 3.605 |
| + FTA EWM (hl 5/15 + T_x + share≥6) | 2.1039 | 1.5294 | 0.4376 | 0.6122 | 3.598 |
| + FT%-form ratio EWM | 2.1059 | 1.5310 | 0.4366 | 0.6116 | 3.605 |
| + opponent foul-proneness (OPP_ALLOWED_FTA) | 2.1048 | 1.5306 | 0.4372 | 0.6121 | 3.608 |
| + usage/TS | 2.1058 | 1.5315 | 0.4366 | 0.6118 | 3.607 |
| + bio/anthro | 2.1070 | 1.5314 | 0.4360 | 0.6116 | 3.607 |
| + core (EWM+form+usage+bio) | 2.1047 | 1.5300 | 0.4372 | 0.6121 | 3.601 |
| **+ core + opponent foul-proneness (shipped)** | **2.1039** | **1.5287** | **0.4377** | **0.6125** | **3.598** |
| LightGBM poisson, f50 | 2.1084 | 1.5230 | 0.4352 | 0.6120 | 3.629 |

### FTM

| Candidate | RMSE | MAE | R² | Spearman | 6+ MAE |
|---|------|-----|----|----------|--------|
| f50 (control) | 1.7869 | 1.2744 | 0.4197 | 0.5962 | 3.675 |
| + FTM EWM (hl 5/15 + T_x + share≥5) | 1.7851 | 1.2737 | 0.4209 | 0.5971 | 3.667 |
| + FT%-form ratio EWM | 1.7868 | 1.2742 | 0.4198 | 0.5962 | 3.672 |
| + opponent foul-proneness | 1.7868 | 1.2748 | 0.4198 | 0.5968 | 3.682 |
| + usage/TS | 1.7869 | 1.2740 | 0.4197 | 0.5969 | 3.676 |
| + bio/anthro | 1.7871 | 1.2739 | 0.4196 | 0.5964 | 3.672 |
| + core | 1.7855 | 1.2733 | 0.4206 | 0.5975 | 3.667 |
| **+ core + opponent foul-proneness (shipped)** | **1.7837** | **1.2725** | **0.4218** | **0.5975** | **3.664** |
| LightGBM poisson, f50 | 1.7875 | 1.2650 | 0.4193 | 0.5972 | 3.686 |

Findings:

- **Opponent foul-proneness (`OPP_ALLOWED_FTA` histories) ships for both** —
  the second rival-defense family of the series, and it came free: the
  columns were added to the allowed-stats machinery by the FG round.
- Interaction effect worth noting: for FTM, opponent foul-proneness is flat
  *alone* but is the difference-maker *on top of core* (1.7855 → 1.7837) —
  the trees combine "opponent fouls a lot" with "player draws and converts"
  into games-with-many-makes.
- LightGBM loses on both (6th/7th confirmation) — the architecture question
  stays closed across all ten targets.

## Tail round (review feedback: "the 6+ is bad")

Ceiling/streak/multi-share candidates on top of the 74, targeting big
foul-drawing nights (fine buckets: 6-8 and 9+ split):

| Candidate (both targets) | FTA RMSE | FTM RMSE | verdict |
|---|---|---|---|
| base 74 (the PR before this round) | 2.1039 | 1.7837 | — |
| + recent ceiling (w10 max, w20 p90) | 2.1038 | 1.7841 | flat |
| + driving streak (consec. games ≥4 FTA) | 2.1038 | 1.7835 | mild |
| **+ multi-threshold shares (shipped)** | **2.1024** | **1.7828** | wins everything |
| + opponent×draw interaction | 2.1040 | 1.7850 | trees already build it |
| + all of the above | 2.1028 | 1.7850 | dilutes the winner |

Multi-threshold shares (P≥2/P≥4 attempts, P≥3 makes) work here where the
same idea failed for PTS: the FT distribution is bimodal (non-drawers vs
drawers), so a coarse CDF carries real shape information. New engine knob:
`EWM_SHARE_EXTRA` ({stat}_share{thr}_* columns).

## Shipped (2026-07-14)

Both `FTA.json` and `FTM.json`: 50 → **80** (target EWM 8, `FT_FORM_ewm10` 1,
usage/TS 4, bio 5, `OPP_ALLOWED_FTA_{global,w10,w5}_{mean,var}` 6, multi-
threshold shares 6). Engine: `EWM_STATS` + FTM/FTA (share lines ≥5 makes /
≥6 attempts); `EWM_RATIO_COMPOSITES` + `FT_FORM`; `EWM_SHARE_EXTRA` for the
tail shares. No new data source, no migration. Reconciler rebuilt from the
new OOF residuals; validation gates reproduced research numbers exactly.

Final vs production: FTA RMSE 2.1065 → **2.1024** (−0.19%), R² 0.4362 →
**0.4384**; FTM RMSE 1.7869 → **1.7828** (−0.23%), R² 0.4197 → **0.4224**.
