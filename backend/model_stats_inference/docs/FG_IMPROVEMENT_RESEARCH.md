# FGM + FGA model improvement research (2026-07-14)

Sixth round of the series (BLK / STL / REB / AST / PTS docs alongside), and
the deepest: both field-goal models at once, with new **rival-defense**
feature families. Production rows/filters, 5-fold `KFold(shuffle,
random_state=0)`, pooled OOF metrics on 74,912 rows. Both targets sit in the
reconciler block, so shipping rebuilds `reconciler.joblib`.

## Baselines (production: `hgb_poisson`, 50 features each)

| Target | RMSE | MAE | R² | PoisDev | Spearman |
|--------|------|-----|----|---------|----------|
| FGA | 2.8169 | 2.1210 | 0.7738 | 0.9607 | 0.8863 |
| FGM | 1.9605 | 1.4784 | 0.6316 | 1.0271 | 0.8030 |

FGA is the most predictable stat in the sheet (attempts are a role decision);
FGM = attempts × conversion, where conversion is mostly shot noise.

## Experiments (all on identical folds)

### FGA

| Candidate | RMSE | MAE | R² | Spearman | 18+ MAE |
|---|------|-----|----|----------|---------|
| f50 (control) | 2.8169 | 2.1210 | 0.7738 | 0.8863 | 3.922 |
| + FGA EWM (hl 5/15 + T_x + share≥15) | 2.8112 | 2.1185 | 0.7747 | 0.8866 | 3.900 |
| + FG%-form + shot-diet | 2.8164 | 2.1206 | 0.7739 | 0.8863 | 3.927 |
| + usage/TS (PTS-work columns) | 2.8108 | 2.1173 | 0.7748 | 0.8867 | 3.913 |
| + bio/anthro | 2.8140 | 2.1194 | 0.7743 | 0.8864 | 3.914 |
| + rival defense: allowed FGA/FTA/TOV | 2.8133 | 2.1192 | 0.7744 | 0.8863 | 3.913 |
| + rival zone defense (allowed RA/paint/mid/3) | 2.8125 | 2.1188 | 0.7745 | 0.8864 | 3.913 |
| + core4 (EWM+form+usage+bio) | 2.8100 | 2.1175 | 0.7749 | 0.8867 | 3.912 |
| **+ core4 + rival defense (shipped)** | **2.8069** | **2.1156** | **0.7754** | **0.8867** | **3.893** |
| + everything (incl. zone defense) | 2.8049 | 2.1149 | 0.7757 | 0.8868 | 3.893 |

### FGM

| Candidate | RMSE | MAE | R² | Spearman | 10+ MAE |
|---|------|-----|----|----------|---------|
| f50 (control) | 1.9605 | 1.4784 | 0.6316 | 0.8030 | 3.330 |
| + FGM EWM (hl 5/15 + T_x + share≥8) | 1.9591 | 1.4775 | 0.6322 | 0.8033 | 3.324 |
| + FG%-form + shot-diet | 1.9600 | 1.4780 | 0.6318 | 0.8031 | 3.327 |
| + usage/TS | 1.9584 | 1.4768 | 0.6324 | 0.8034 | 3.319 |
| + bio/anthro | 1.9597 | 1.4781 | 0.6319 | 0.8032 | 3.327 |
| + rival defense (allowed FGA/FTA/TOV) | 1.9608 | 1.4791 | 0.6315 | 0.8028 | 3.327 |
| + rival zone defense | 1.9610 | 1.4794 | 0.6314 | 0.8027 | 3.338 |
| **+ core4 (shipped)** | **1.9580** | **1.4766** | **0.6326** | **0.8035** | **3.325** |
| + core4 + rival defense | 1.9583 | 1.4769 | 0.6324 | 0.8033 | 3.327 |
| + everything | 1.9578 | 1.4769 | 0.6327 | 0.8032 | 3.323 |

Findings:

- **Rival attempt-suppression defense (allowed FGA/FTA/TOV) is real signal for
  FGA** — first opponent-side feature family in the series to ship. It works
  for attempts (how many shots the defense concedes) and does nothing for
  makes (conversion is about the shooter) — exactly the basketball prior.
  Integrated by extending `OPP_ALLOWED_STATS`; all three columns already exist
  in `fs_team_games`, **no DB migration**.
- **FGA core4+oppdef is the largest strictly-dominating gain of the entire
  6-model series** (−0.35% RMSE, every bucket better incl. −0.74% on 18+).
- **Rival zone defense (shot charts) helps FGA further** (−0.07% more) but
  needs a shot-zone table + nightly shot-chart ingestion; documented as the
  known next step, not shipped (same call as the REB opponent-environment).
- FGM ships core4 only; the everything-variant's extra −0.0002 RMSE does not
  justify 24 extra features, several migration-bound.
- New ratio composites: `FG_FORM` (FGM/FGA — "is he hot") and `SHOT_DIET3`
  (FG3A/FGA — shot-mix drift).

## Shipped (2026-07-14)

- `FGA.json`: 50 → **87** (FGA EWM 8, FG-form/diet 2, usage/TS 4, bio 5,
  `OPP_ALLOWED_{FGA,FTA,TOV}_{global,w10,w5}_{mean,var}` 18).
- `FGM.json`: 50 → **69** (FGM EWM 8, FG-form/diet 2, usage/TS 4, bio 5).
- Engine: `EWM_STATS` + FGM/FGA (share lines ≥8 makes / ≥15 attempts);
  `EWM_RATIO_COMPOSITES` + FG_FORM, SHOT_DIET3; `OPP_ALLOWED_STATS` + FGA,
  FTA, TOV (team-allowed table and team vectors gain the columns everywhere).
- Reconciler rebuilt from the new OOF residuals (FGM and FGA are both in the
  coherence identity); validation gates reproduced research numbers exactly
  for both targets before retraining.
