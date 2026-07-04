# Forecast reconciliation — making the shooting line add up

## The problem

We train one model per stat, independently. Nothing ties them together, so their
predictions don't have to obey the basketball **scoring identity**:

```
PTS = 2·FGM + FG3M + FTM
```

(A made three is counted in **both** FGM and FG3M, so it contributes `2 (from FGM) +
1 (from FG3M) = 3`. That's why the coefficient on FG3M is **+1**, not +3.)

So the PTS model might say 20 while the component models imply 22. The line is
"incoherent." We fix this with **MinT optimal reconciliation** — one small, learned
linear adjustment that makes the line add up, keeps it minimum-variance, and moves
makes and attempts together (lower FTM ⇒ lower FTA) automatically.

We reconcile the **shooting block only** — `[PTS, FGM, FG3M, FTM, FGA, FTA]`.
REB/AST/STL/BLK aren't in the scoring identity, so they pass through untouched.

---

## 1. The variables and the constraint

Stack the six predictions in a fixed order:

```
y = [PTS, FGM, FG3M, FTM, FGA, FTA]ᵀ  ∈ ℝ⁶
```

The identity is a single linear constraint `A y = 0`:

```
A = [ +1(PTS), −2(FGM), −1(FG3M), −1(FTM), 0(FGA), 0(FTA) ]
A y = PTS − 2·FGM − FG3M − FTM
```

`{y : A y = 0}` is the **coherent subspace**. A raw prediction `ŷ` usually sits just
off it; the scalar `A ŷ` is the **incoherence** (e.g. `A ŷ = −2` means PTS is 2 short
of what the components imply). FGA and FTA have coefficient 0 — they ride along only
through the covariance (see §4).

---

## 2. What we learn: the error covariance `W`

The only thing estimated from data. From the **k-fold cross-validation** we already
run, each model produces out-of-fold (OOF) predictions on held-out rows. Per row we
form the residual vector `e = y_true − ŷ` over the six stats, then:

```
W = Cov(e)        # 6×6, estimated with Ledoit–Wolf shrinkage (well-conditioned)
```

`W` captures two things:
- **Diagonal** — each model's error size (≈ its RMSE²). Smaller ⇒ trust it more ⇒
  move it less.
- **Off-diagonal** — which errors move *together*. Empirically `corr(e_FTM, e_FTA) ≈
  0.93` and `corr(e_FGM, e_FGA) ≈ 0.69`: a high-usage night inflates makes **and**
  attempts. This is what lets reconciliation move attempts when it moves makes.

No new fitting — it's a covariance of residuals we already have.

---

## 3. The reconciliation projection (MinT)

Find the coherent `ỹ` closest to the raw `ŷ`, measured in the `W⁻¹` (Mahalanobis)
metric — i.e. distance counted in units of each model's reliability:

```
minimize  (ỹ − ŷ)ᵀ W⁻¹ (ỹ − ŷ)      subject to   A ỹ = 0
```

The Lagrangian solution is closed-form. Define the **gain** vector

```
G = W Aᵀ (A W Aᵀ)⁻¹        # 6×1  (A is 1×6, so A W Aᵀ is a scalar — no real matrix inverse)
```

then

```
ỹ = ŷ − G · (A ŷ)
```

In words: compute the single scalar incoherence `A ŷ`, and subtract it back out,
**spread across all six stats** in the proportions `G`. `G` is precomputed once at
training time; at inference it's a dot product and a vector subtraction.

---

## 4. Why attempts move when makes move (the key trick)

Each gain entry is

```
G_j ∝ (W Aᵀ)_j = Cov(e_j, e_PTS) − 2·Cov(e_j, e_FGM) − Cov(e_j, e_FG3M) − Cov(e_j, e_FTM)
```

Take `j = FGA`. It has coefficient **0** in the constraint `A`, yet its gain is
**nonzero**, because `Cov(e_FGA, e_FGM)` is large. So whenever reconciliation nudges
FGM to satisfy the identity, **FGA is pulled along, in proportion to how correlated
their errors are.** That's the "smart" coupling — it's not hand-coded; it falls out
of `W`.

**This is why we must use the full `W` (MinT), not `W = I` (plain OLS reconciliation).**
With `W = I`, `G_FGA = 0` and attempts would never move — you'd keep coherence but
lose the make↔attempt coupling and the reliability weighting.

Learned gains on our data (`G`):

```
PTS  +0.587   FGM −0.130   FG3M −0.045   FTM −0.110   FGA +0.050   FTA −0.058
```

PTS absorbs most of the correction (it's the noisiest of the six), the makes adjust,
and FTA tracks FTM (both negative → they move the same direction).

---

## 5. Worked example

Raw model output for a player:

```
PTS=30, FGM=8, FG3M=2, FTM=4, FGA=15, FTA=5
incoherence  A ŷ = 30 − (16 + 2 + 4) = +8     # PTS is 8 too high vs the parts
```

Apply `ỹ = ŷ − G·8`:

```
PTS  = 30 − 0.587·8 = 25.3
FGM  = 8  − (−0.130)·8 = 9.0
FG3M = 2  − (−0.045)·8 = 2.4
FTM  = 4  − (−0.110)·8 = 4.9
FGA  = 15 − (+0.050)·8 = 14.6
FTA  = 5  − (−0.058)·8 = 5.5
```

Check: `2·9.0 + 2.4 + 4.9 = 25.3 = PTS` ✓. PTS came down, the makes came up to meet
it, and FTA rose with FTM (FT% stays ≈ 4.9/5.5). Coherent and sensible.

---

## 6. Post-processing (clip, clamp, derive PTS)

After the projection we enforce structural facts and then **re-derive PTS** so the
identity is exact even if a clamp moved a component:

```
clip all ≥ 0
FGA  = max(FGA, FGM)      # can't make more than you attempt
FTA  = max(FTA, FTM)
FG3M = min(FG3M, FGM)     # threes ⊆ field goals
PTS  = 2·FGM + FG3M + FTM # derive last → identity holds to machine precision
```

Then FG% and FT% are derived from the reconciled components (`FGM/FGA`, `FTM/FTA`).

---

## 7. Integer-coherent display

Reconciliation makes the **floats** satisfy the identity exactly. But rounding each
stat independently can break it:

```
round(20.9) = 21       vs    2·round(7.7) + round(2) + round(3.7) = 2·8 + 2 + 4 = 22
```

So in the UI's integer mode we **derive the displayed integer PTS from the rounded
components** (never round PTS on its own):

```
PTS* = 2·round(FGM) + round(FG3M) + round(FTM)
FGA* = round(FGA) (≥ round(FGM)),  FTA* = round(FTA) (≥ round(FTM))
FG%* = round(FGM)/FGA*  (or "—" if FGA* = 0),   FT%* = round(FTM)/FTA*  (or "—")
```

This guarantees the whole-number line that Asaf sees also obeys
`PTS = 2·FGM + FG3M + FTM`, exactly.

---

## Where it lives in the code

- **`training/reconcile.py`** — `build_reconciler(results)`: aligns the OOF residuals
  by `(row)` for the six shooting stats, estimates `W` (Ledoit–Wolf), computes `G`,
  and saves `models/reconciler.joblib`. Called at the end of `training/train.py:main()`.
- **`serving/reconcile.py`** — `Reconciler.apply(Y)`: the vectorized projection +
  clip/clamp + derive-PTS, over a whole batch of players (one `n×6` matmul).
- **`serving/inference.py`** — loads the reconciler and applies it inside
  `predict_many` before deriving FG%/FT%. Always on when the reconciler is present.
- **`frontend/src/pages/Projections.tsx`** and **`frontend/src/components/MatchupDisplay.tsx`** —
  `ptsIntFromComponents(...)` for the integer-coherent display.

## Cost

Negligible. `W`/`G` are estimated once at train time from residuals we already have.
At inference, reconciling a 180-player slate is a single `180×6` matmul — microseconds
on top of the model predictions.
