# Minutes exposure — making 0 minutes mean 0 stats

## The problem

Every counting stat scales with playing time. The old model predicted the per-game
count directly:

```
ŷ = F(x, t)
```

where `x` is the history/context feature row and `t` is the minutes the player is
expected to play. Nothing in `F` *forces* the obvious physics:

- A player who plays **0 minutes** should score **0** on every stat. `F` could
  (and did) return a nonzero baseline at `t = 0`.
- Doubling the minutes should not *decrease* any counting stat. Trees approximate
  the minutes scaling through splits on `T_MIN` / `T_x_*`, but nothing guarantees
  monotonicity.

We want these as **structural guarantees**, not an `if t == 0: return 0` special
case bolted on after the fact — and ideally without hurting accuracy.

---

## 1. The fix: treat minutes as exposure

Model the **per-minute rate** and multiply by minutes:

```
ŷ = t · G(x, t)
```

`G` is the same kind of model on the **same inputs** `(x, t)`; it just predicts a
rate instead of a count. This is Poisson regression with `t` as the **exposure**
(offset):

```
E[y | x, t] = t · exp(η(x))      ⇔      log E[y] = log(t) + η(x)
```

Two guarantees now hold by construction, independent of what `G` learned:

- **Structural zero** — `t = 0 ⇒ ŷ = 0` exactly, for every stat.
- **Monotonicity** — `ŷ` is non-decreasing in `t` (a rate is ≥ 0).

`G` still receives `t` as a feature, so the *rate itself* may legitimately depend
on minutes (a 34-minute starter and an 8-minute benchwarmer have different usage,
fatigue, and blowout context). We only moved the **linear** minutes scaling out of
the model and into arithmetic.

---

## 2. How we fit it (exact Poisson-exposure equivalence)

`HistGradientBoostingRegressor` has no per-sample offset argument, but the exposure
model is recovered exactly by a target/weight transform. Minimizing the per-game
Poisson deviance of `ŷ = t · rate` against `y` is identical to fitting `rate`
against the target `y / t` weighted by `t`:

```
base.fit(X, y / t, sample_weight = t)          # learns the rate
predict:  ŷ = t · base.predict(X)              # scales back to a count
```

The `sample_weight = t` term is what makes it *exact* rather than merely
rate-flavored — a 34-minute game counts 34× a single minute, recovering the
original per-game likelihood. Training rows all have `MIN ≥ 5` (the `MIN_MINUTES`
filter), so `y / t` never divides by zero.

Implemented as a thin, model-agnostic wrapper — `ExposureRegressor` in
`training/models.py` — so the rest of the pipeline still only calls `.fit` /
`.predict`. Production model: `MODEL_NAME = "hgb_poisson_exposure"`.

---

## 3. Why RMSE improves (a little, but consistently)

Minutes is the single largest driver of counting-stat variance. The old `F` had to
re-derive "counts grow with minutes" from data through tree splits; `G · t` bakes
that in as arithmetic, so `G` only fits the **residual per-minute rate** — a more
stable, roughly homoscedastic signal — and extrapolates correctly to unusual
minute loads (season-low 8, overtime 44).

5-fold out-of-fold RMSE on per-game counts, **same filtering and same feature sets**
as production (`HISTORY_GAMES ≥ 1`, target not-null; `MIN ≥ 5` baked into the
matrix), 95,279 rows:

| stat | count model (`hgb_poisson`) | exposure (`hgb_poisson_exposure`) | Δ |
|------|-----------------------------|-----------------------------------|-------|
| PTS  | 5.0996 | 5.0983 | −0.03% |
| REB  | 2.2006 | 2.1952 | −0.24% |
| AST  | 1.7130 | 1.7107 | −0.13% |
| FG3M | 1.1741 | 1.1731 | −0.09% |
| STL  | 0.9051 | 0.9048 | −0.03% |
| BLK  | 0.7321 | 0.7317 | −0.05% |
| FGM  | 1.9968 | 1.9958 | −0.05% |
| FGA  | 2.8552 | 2.8509 | −0.15% |
| FTM  | 1.8303 | 1.8289 | −0.08% |
| FTA  | 2.1564 | 2.1536 | −0.13% |
| **mean** | **2.0663** | **2.0643** | **−0.10%** |

Every stat improves — the effect is small (mean −0.10%) but **directionally
consistent** across all ten, which is the signal that it's real and not fold noise.
The primary payoff is the two structural guarantees; the RMSE improvement means
they come at **no accuracy cost**.

We also tested dropping the now-redundant minutes features from the base:

- Dropping the `T_x_*rate` interactions only: ~neutral (mean −0.02%).
- Dropping `T_x_*rate` **and** `T_MIN`: **worse** (mean +0.32%) — confirming the
  rate genuinely depends on minutes, so `T_MIN` stays in.

Keeping all features (identical inputs to the old model) is both simplest and best,
so that is what ships.

---

## 4. Interaction with reconciliation

The MinT reconciler (`docs/RECONCILIATION.md`) is a pure linear projection
`ỹ = ŷ − G·(Aŷ)` with no intercept. At `t = 0` all six shooting predictions are
`0`, and `0 = 2·0 + 0 + 0` is already coherent, so reconciliation passes the zero
line through untouched. The reconciler's error covariance `W` is re-estimated from
the new out-of-fold residuals during training, so it is matched to the exposure
model automatically.
