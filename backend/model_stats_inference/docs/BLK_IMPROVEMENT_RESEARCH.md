# BLK model improvement research (2026-07-14)

Systematic attempt to improve the per-stat BLK model. **Protocol identical to
production throughout**: same feature matrix rows, same filters (regular season,
`MIN >= 2`, `>= 20` games/player, `>= 1` prior game), same 5-fold
`KFold(shuffle, random_state=0)`, predictions clipped at 0. All numbers are
pooled out-of-fold metrics on 74,912 rows.

## Baseline (production: `hgb_poisson`, 50 Lasso-selected features)

| RMSE | MAE | R² | PoisDev | Spearman | MAE (BLK≥2) |
|------|-----|----|---------|----------|-------------|
| 0.7228 | 0.5145 | 0.260 | 0.8886 | 0.430 | 1.519 |

## Key finding: the model is near the statistical ceiling

Blocks in a single game are approximately Poisson around the player's true
per-game rate. With `mean(BLK) = 0.479` and `var(BLK) = 0.706`:

- irreducible (within-game) variance = **0.479** → noise-floor RMSE ≈ **0.69**
- explainable (between player-game-rate) variance ≤ 0.706 − 0.479 = 0.227
- **maximum achievable R² ≈ 0.32**

The production model's R² of 0.260 already captures **~81% of the explainable
variance**. Any honest improvement is bounded to a few RMSE points; a "drastic"
jump is mathematically impossible for this target with any features/model.

## Experiments run

### 1. Model sweep (existing 50 + all 287 features)

| Model | RMSE | MAE | R² |
|-------|------|-----|----|
| hgb_poisson (prod) | **0.7228** | 0.5145 | **0.260** |
| hgb_poisson bigger (1500 iters, 63 leaves) | 0.7238 | 0.5141 | 0.258 |
| LightGBM poisson | 0.7247 | 0.5079 | 0.256 |
| LightGBM tweedie(1.3) | 0.7320 | 0.4846 | 0.241 |
| LightGBM L2 | 0.7327 | 0.5153 | 0.240 |
| LightGBM multiclass→expectation | 0.7482 | 0.4914 | 0.207 |
| any of the above on all 287 features | ≥ 0.7231 | — | ≤ 0.259 |

Tweedie/multiclass "improve" MAE only by predicting more zeros — RMSE, R²,
and tail error (BLK≥2) all get worse. Not a real improvement.

### 2. New features (60, all leakage-safe, same windowing engine)

Built from newly fetched data (cached under the research scratchpad):

- **Opponent offense profile** (`team_logs`): 2PA, 2PM, FG3A, FTA, OREB, TOV,
  pace over the opponent's prior games (global/w10/w5 mean+var).
- **Player bio** (`playerindex`): height/weight for all 806 players, 0 missing.
- **Player block extras**: EWMA of BLK and BLK-per-minute (halflife 5/15),
  share of prior games with ≥1 block, 20-game window, max in last 10.
- **Matchup history**: player's prior BLK mean vs this same opponent.
- **Shot-location rim pressure** (`shotchartdetail`, per team-game zone counts):
  opponent restricted-area / paint / mid / three attempt history + rim share,
  and an expected-blocks interaction `BLK_rate_ewm × T_MIN × opp_RA_attempts`.

| Feature set (hgb_poisson) | RMSE | MAE | R² | Spearman | MAE (BLK≥2) |
|---------------------------|------|-----|----|----------|-------------|
| f50 (control) | 0.7228 | 0.5145 | 0.2600 | 0.4301 | 1.5187 |
| f50 + curated new ("lean") | 0.7223 | 0.5140 | 0.2611 | 0.4307 | 1.5161 |
| f50 + shot-zone | 0.7223 | 0.5145 | 0.2610 | 0.4303 | 1.5184 |
| f50 + lean + shot | 0.7223 | 0.5142 | 0.2610 | 0.4305 | 1.5171 |

LGBM gain importances show the new features are *used heavily* —
`T_x_BLKrate_ewm15` is the #2 feature overall, `HEIGHT_IN` top-10,
`E_BLK_RA` #4 — but they are **redundant** with `T_x_BLK_global_rate` and
`OPP_ALLOWED_BLK_*` (opponent blocks-allowed already proxies rim pressure).
Net effect: consistent but tiny gains on every metric.

### 3. Diverse-loss blend

OOF blend of hgb_poisson (lean feats) + lgbm_poisson + lgbm_tweedie with
fold-honest weight selection (weights for each fold chosen only on the other
folds; converged to ≈ 0.67 / 0.27 / 0.07).

| Candidate | RMSE | MAE | R² | PoisDev | Spearman | MAE (BLK≥2) |
|-----------|------|-----|----|---------|----------|-------------|
| baseline (prod) | 0.7228 | 0.5145 | 0.2600 | 0.8886 | 0.4301 | 1.5187 |
| hgb_poisson + lean feats | 0.7223 | 0.5140 | 0.2610 | 0.8880 | 0.4307 | **1.5160** |
| blend (rmse-opt, honest) | **0.7217** | 0.5095 | **0.2622** | **0.8865** | **0.4322** | 1.5242 |
| blend fixed 50/25/25 | 0.7221 | **0.5037** | 0.2615 | 0.8882 | **0.4322** | 1.5390 |

The blend is the only change that moved every headline metric in the right
direction at once (RMSE −0.15%, MAE −1.0%, R² +0.9%, Spearman +0.5%); the
fixed-weight variant buys a 2.1% MAE gain at a small cost in tail error.
`hgb_poisson + lean features` is the only candidate that strictly dominates
the baseline on **all six** metrics, tail included — just by very little.

### 4. Previously-unused NBA data sources

Audited nba_api for data the pipeline never used, fetched and tested each
(per-game where possible, all leakage-safe EWMAs):

- **Draft-combine anthro** (`draftcombineplayeranthro`, 2000–2025): wingspan,
  standing reach, wingspan−height. Coverage 65% of players (NaN-safe in HGB).
- **Per-game Usage logs** (`PlayerGameLogs, measure=Usage`): `PCT_BLK` (share
  of team blocks while on floor), `PCT_BLKA`, `USG_PCT`.
- **Per-game Advanced logs** (`measure=Advanced`): `DEF_RATING`, `PIE`, pace.
- **Unused columns in our own parquet**: `PFD` (fouls drawn), `BLKA`.

| Feature set (hgb_poisson) | RMSE | MAE | R² | Spearman | MAE (BLK≥2) |
|---------------------------|------|-----|----|----------|-------------|
| f50 (control) | 0.7228 | 0.5145 | 0.2600 | 0.4301 | 1.5187 |
| f50 + anthro | 0.7226 | 0.5144 | 0.2605 | 0.4310 | 1.5179 |
| f50 + usage/advanced | 0.7233 | 0.5147 | 0.2591 | 0.4299 | 1.5189 |
| f50 + usage + anthro | 0.7229 | 0.5141 | 0.2598 | 0.4306 | 1.5168 |
| **f50 + everything (anthro+usage+lean)** | **0.7222** | **0.5140** | **0.2612** | 0.4310 | **1.5161** |

Wingspan/reach: real but tiny gain. Usage/advanced per-game logs: pure noise
(slightly negative alone). The "everything" set is the best single-model
configuration found — strictly better than baseline on all six metrics.

## Conclusion

- The production `hgb_poisson` choice is validated: best RMSE/R² of 6 model
  families tested.
- New data sources (height, rim pressure, matchup history, EWMAs) carry real
  signal but overlap almost entirely with the existing 50 features.
- The model sits ~81% of the way to the Poisson ceiling; remaining headroom
  ≈ 0.03 RMSE at absolute best, of which the experiments above capture ~0.001.
- Best practical upgrades found (pick one):
  1. **Blend** (hgb_poisson-lean 0.67 / lgbm_poisson 0.27 / lgbm_tweedie 0.07):
     improves every headline metric; needs LightGBM in serving + 3× inference.
  2. **hgb_poisson + lean features**: strictly dominates baseline on all six
     metrics (incl. tail) with the same single-model serving path; needs the
     new features (bio, EWMAs, opponent-offense) wired into the research
     pipeline + feature store.

## Shipped (2026-07-14)

Option 2, as 13 new features on the production BLK model (63 total):
bio/anthro (`HEIGHT_IN, WEIGHT_LB, WINGSPAN_IN, REACH_IN, WING_MINUS_HEIGHT`),
EWM block history (`BLK_ewm{5,15}_mean`, `BLK_ewm{5,15}_rate` +
`T_x_BLK_ewm{5,15}_rate`), and block-share (`BLK_share_ewm10`,
`BLK_share_global`). Final 5-fold CV, same protocol:

| | RMSE | MAE | R² | MAE (BLK≥2) |
|---|------|-----|----|-------------|
| before | 0.7228 | 0.5145 | 0.2600 | 1.5187 |
| shipped | **0.7219** | **0.5135** | **0.2619** | **1.5146** |

Per-bucket OOF error (n = games with that actual block count):

| Actual BLK | n | MAE before | MAE after | Δ |
|---|---|---|---|---|
| 0 | 50,377 | 0.362 | 0.361 | −0.35% |
| 1 | 16,879 | 0.515 | 0.516 | +0.23% |
| 2 | 5,228 | 1.190 | 1.190 | −0.07% |
| 3 | 1,607 | 1.854 | 1.846 | −0.39% |
| 4+ | 821 | 2.953 | 2.934 | −0.64% |

Ops footprint: +339 B/player in the `fs_player_vectors` JSON blob (~0.2 MB
total; the table is one upserted row per player and does not grow with games),
22 KB committed bio artifact, raw-row tables and DB schema unchanged.
Inference latency unchanged: 0.71 ms/player for a full 618-player slate both
before and after. Vector re-materialization (all players, 3 seasons) is 0.26 s.
- To move meaningfully further one would need *information not in box scores*:
  starting-lineup / injury news (opposing rim protectors in/out), tracking
  data (rim deterrence, contest rates), or Vegas-style priors.
