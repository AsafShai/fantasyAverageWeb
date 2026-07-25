# Usage rate (USG%) — pace-normalized possession share

## The metric

Dean Oliver's usage rate (*Basketball on Paper*, 2004) — the share of his team's
offensive possessions a player finishes while on the floor:

```
USG% = 100 · (FGA + 0.44·FTA + TOV) · (Tm MP / 5)
            ────────────────────────────────────────
              MP · (Tm FGA + 0.44·Tm FTA + Tm TOV)
```

A possession ends in a shot, a trip to the line, or a turnover — that is the
numerator. The denominator is the team's possessions over the same floor time, so
the result is a **percentage where 20% is exactly average** (five players sharing
100% of the offense).

**Why 0.44 and not 0.5.** Free throws don't map one-to-one onto possessions: and-ones
come after a made basket, three-shot fouls give three attempts for one possession,
technicals end nobody's possession. Oliver measured the average trip against
play-by-play and got ≈0.44 of a possession per attempt. It is a fitted constant, not
a derived one — and the same 0.44 already appears in `TEAM_PACE` (`data.py:155`) and
the `USAGE_LOAD` composite (`config.py`).

## What was already there, and what was missing

The pipeline had `USAGE_LOAD = (FGA + 0.44·FTA + TOV) / MIN` — Oliver's **numerator
only**, per minute. It never divided by team possessions, so team pace stayed baked
in: a high-usage player on a slow team and a lower-usage player on a fast team looked
alike. `USG` adds the missing denominator, separating *how much of the offense a
player runs* from *how fast his team plays*.

## The research

5-fold OOF RMSE, all 10 stats × 4 window configs, production estimator and filtering
(`HISTORY_GAMES ≥ 1`, 95,279 rows). **Averaged over all stats, every fixed window
config came out at zero**: w5 −0.00%, w10 −0.01%, global +0.01%, all −0.01%.

Taking the best-of-4 per stat made several look like winners, but that is selection
after the fact (winner's curse), so we re-tested each candidate at its *chosen* window
across **3 seeds**, varying both the CV split and the model's `random_state`:

| stat | window(s) | seed 0 | seed 1 | seed 2 | mean Δ |
|------|-----------|--------|--------|--------|--------|
| FGA  | w10 | −0.044% | −0.065% | −0.022% | **−0.044%** |
| FGM  | w5  | −0.044% | −0.027% | −0.005% | **−0.025%** |
| FTM  | w5+w10+global | −0.045% | −0.014% | −0.011% | **−0.023%** |
| FTA  | w5+w10+global | −0.024% | −0.016% | −0.010% | **−0.017%** |
| PTS  | w10 | −0.024% | +0.005% | −0.018% | **−0.012%** |
| FG3M | w5  | −0.019% | +0.006% | +0.010% | **−0.001%** |

The pattern is mechanistic, not random: the stats that improve are the shot- and
free-throw-volume stats that USG% is **literally built from** (FGA and FTA are its
numerator; FGM/FTM are their makes). FG3M — a *subset* of FGM — averages to −0.001%,
i.e. exactly nothing, and is the one candidate we dropped. PTS is a *composite*
(2·FGM + FG3M + FTM); it flipped on one seed, but its two gains (−0.024%, −0.018%)
far outweigh the single +0.005% blip, so it nets clearly negative and was kept.

**Adopted for: PTS, FGM, FGA, FTM, FTA. Not FG3M, and not REB/AST/STL/BLK** (usage
has no mechanical link to rebounds, assists, steals or blocks, and they measured
neutral-to-worse).

Be honest about the size: the effect is ≈0.03%. FGA moves 2.851 → 2.850. This is a
real but economically negligible gain, kept because it is directionally consistent
and mechanically justified — not because it changes what a user sees.

## Implementation

`USG` is **derived, not stored**. It needs the game's team possessions, which live
only in `team_own.TEAM_PACE`, so persisting it as a raw column would have meant an
`fs_player_games` schema migration plus changes to every ingest path. Instead
`features.attach_usage(players, team_own)` joins the pace and computes the per-game
value, and `"USG"` is registered in `config.BASE_STATS` so the existing window engine
emits `USG_{global,w10,w5}_{mean,var}`.

It is called in exactly two places — `build_feature_matrix` (training) and
`build_current_state` (serving) — which guarantees identical columns on both sides.
Not in `RATE_STATS` (USG is already a rate, so no `T_x_` minutes interaction) and not
in `TARGETS`.

Two correctness details worth keeping in mind:

- **USG must never be NaN.** `compute_history_features` accumulates with `np.cumsum`,
  so a single NaN would poison every later window for that player. Hence the
  median-pace imputation and the final `fillna` in `attach_usage`.
- **`pace_source`.** The nightly `_recompute` passes a `team_own` filtered to the
  teams that played, but a traded player's earlier games belong to a club that may
  not have played that night. `build_current_state(..., pace_source=self.team_own)`
  supplies the full frame for the USG join while team vectors still recompute only
  the affected teams.

## Deploying a feature change

No SQL migration: feature vectors are a JSONB blob keyed by feature name
(`migrations/create_feature_vector_tables.sql`), so new columns are new JSON keys.
A **data re-materialization** is required, and it is automatic — `run_catchup` checks
whether the deployed models need a feature the store lacks and, if so, rebuilds all
vectors once. Deploying is therefore the whole procedure. See "Deploying a model or
feature change" in `serving/README.md`, and `scripts/refresh_feature_vectors.py` for
the manual override.
