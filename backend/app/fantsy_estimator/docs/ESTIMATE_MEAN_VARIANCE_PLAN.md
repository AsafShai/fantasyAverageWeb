# Plan: Estimate per-stat mean (final value) and variance from window mean/cov

## Goal

From the window estimator output (mean_vector and covariance_matrix, both keyed by stat) plus current team state and nba_avg_pace, compute:

1. **Estimated final value per stat** (mean of the season total)
2. **Variance per stat** (uncertainty of that total)
3. **Full covariance matrix** for the remaining totals (so we keep correlations)

Use config for season cap: **max_gp = num_nba_games × num_players_in_team** (e.g. 82 × 10 = 820).

---

## Constants (from config)

- **max_gp** = `num_nba_games * num_players_in_team` (e.g. 820)
- **nba_avg_pace** = passed in (e.g. 64 = NBA games played so far per team)

---

## Step 1: Current state per team

From the team’s preprocessed snapshot (e.g. **last row** by scoring_period_id or period_index):

- **num_games_played_now** = that row’s `gp` (cumulative games played for the team so far).
- **current_state[stat]** = that row’s cumulative total for each stat (e.g. `pts`, `reb`, `fgm`, `fga`, `ftm`, `fta`, `three_pm`, `ast`, `stl`, `blk`). So we have current totals for each stat.

(Use the same stat list as the window estimator: the sum stats that map to mean_vector / covariance_matrix.)

---

## Step 2: How many games the team will actually play (projected total GP)

Some managers/teams are “sleeping” (don’t fill all slots), so we don’t assume they’ll reach 820. Use league pace to project:

- **projected_total_gp** = min( max_gp,  num_games_played_now / (nba_avg_pace × 10) × max_gp )

Interpretation: `nba_avg_pace * 10` ≈ league-average roster GP so far. The ratio `num_games_played_now / (nba_avg_pace * 10)` is how this team is doing vs league. Multiply by max_gp to project their total GP, then cap at max_gp.

- **remaining_games** = projected_total_gp − num_games_played_now  
  (use max(0, …) if needed)

This **n** = remaining_games is the “n we calc later” used for scaling mean and cov.

---

## Step 3: Estimated final value per stat (mean of season total)

Naive method:

- **estimated_final[stat]** = current_state[stat] + mean_vector[stat] × remaining_games

So: current total + (per-game mean from window) × number of games left.  
Use the same stat keys as in mean_vector (e.g. map to `avg_*_in_period` names or the underlying stat names consistently).

---

## Step 4: Full covariance matrix for the *remaining* totals

The window estimator gives a **per-game** covariance matrix Σ (index and columns = stat names).

For the sum of **n** future games (same mean and cov per game), the covariance of the **total over those n games** is:

- **full_cov_remaining** = n × Σ

(i.e. each element multiplied by n). So we get a DataFrame with the same index and columns as Σ, values = n × covariance_matrix.

---

## Step 5: Variance per stat

Variance of the **remaining** total for each stat is the diagonal of the full cov:

- **variance_remaining[stat]** = full_cov_remaining.loc[stat, stat]

If we need variance of the **final** season total (current + remaining), and we treat current as fixed: Var(final) = Var(remaining) = variance_remaining[stat]. So we can expose:

- **variance[stat]** = n × covariance_matrix.loc[stat, stat]

So: easy from the cov, multiplied by the **n** we computed (remaining_games).

---

## Step 6: Outputs to produce

1. **estimated_final** — dict or Series: stat → estimated final total.
2. **variance** (or variance_remaining) — dict or Series: stat → variance of (remaining total or final total, as decided).
3. **full_cov_remaining** — DataFrame: index and columns = stat names, values = n × Σ (full cov of the remaining totals).

All use the same stat keys (e.g. the avg_*_in_period names or a consistent list from config/columns).

---

## Summary

- **max_gp** = config.num_nba_games × config.num_players_in_team (820).
- **num_games_played_now** = team’s current cumulative `gp` (last row).
- **projected_total_gp** = min(max_gp, num_games_played_now / (nba_avg_pace × 10) × max_gp).
- **remaining_games** = projected_total_gp − num_games_played_now.
- **estimated_final[stat]** = current_state[stat] + mean_vector[stat] × remaining_games.
- **full_cov_remaining** = remaining_games × covariance_matrix (DataFrame).
- **variance[stat]** = full_cov_remaining.loc[stat, stat] = remaining_games × covariance_matrix.loc[stat, stat].

---

## Percentage stats (fg_pct, ft_pct): mean and variance of ratio x/y

We have mean, variance, and cov for the **components** (FGM, FGA, FTM, FTA). The percentages are ratios:

- **fg_pct** = FGM / FGA  
- **ft_pct** = FTM / FTA  

**x and y are not independent** (e.g. FGM and FGA are correlated). So we must use the **theoretical formula that includes the correlation (covariance)** — we do not assume independence.

So we need E[x/y] and Var(x/y) from E[x], E[y], Var(x), Var(y), **Cov(x,y)**.

### Mean of ratio (point estimate)

Use the ratio of (estimated) totals:

- **estimated_final_fg_pct** = estimated_final_fgm / estimated_final_fga  
- **estimated_final_ft_pct** = estimated_final_ftm / estimated_final_fta  

(Guard: if estimated_final_fga == 0 or estimated_final_fta == 0, use NaN or a default.)

So we **don’t** use E[FGM]/E[FGA] from per-game means then scale; we use the **final** estimated totals so the ratio is consistent with the same denominator.

### Variance of ratio (delta method, with correlation)

For a ratio R = x/y, **x and y are correlated** (Cov(x,y) ≠ 0). The delta method (Taylor expansion) gives the correct expression that includes the covariance term:

**Var(x/y) ≈ (1/μ_y)² Var(x) + (μ_x/μ_y²)² Var(y) − 2 (μ_x/μ_y³) Cov(x,y)**

The **−2 (μ_x/μ_y³) Cov(x,y)** term is the correlation correction. Do not assume independence; use the Cov(x,y) from the full covariance matrix (full_cov_remaining or the per-total cov we have for FGM, FGA).

Use the **final** totals for μ_x, μ_y (estimated_final_fgm, estimated_final_fga, etc.), and the **variances and covariance of the totals** from full_cov_remaining.

So:

- **variance_fg_pct** = (1/μ_fga)² Var(FGM) + (μ_fgm/μ_fga²)² Var(FGA) − 2 (μ_fgm/μ_fga³) Cov(FGM, FGA)  
  with μ_fgm = estimated_final_fgm, μ_fga = estimated_final_fga, and Var/Cov from full_cov_remaining.

- **variance_ft_pct** = same formula with FTM, FTA.

(Guard: if μ_fga or μ_fta is 0, variance is undefined; use NaN or skip.)

So: we **do** use the component means (as the estimated final totals) and the component variances/cov (from the full cov we already have) and plug them into the delta formula to get variance of the percentage.

---

Then we can add a small fix/refinement pass (e.g. edge cases, or storing only components and deriving percentages when needed) in a follow-up.
