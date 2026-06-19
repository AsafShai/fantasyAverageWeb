# Plan: Smart estimator (prediction + covariance matrix)

## Approach

The estimator is **not** per-stat. It is a **smart estimator** that produces, in one go:

1. **Prediction** — estimated final values (vector).
2. **Covariance matrix** — uncertainty and correlations, all together.

## State / covariance: made and taken, not percentages

In the **covariance matrix** we do **not** use `fg_pct` and `ft_pct` as dimensions. We use:

- **FGM, FGA** (made and taken for field goals)
- **FTM, FTA** (made and taken for free throws)
- (Plus the counting stats: three_pm, reb, ast, stl, blk, pts as needed.)

So the prediction vector and the rows/columns of the cov matrix are in terms of **made and taken**, not the percentage ratios. We can derive fg_pct and ft_pct from FGM/FGA and FTM/FTA after the fact if needed.

---

## Preprocessing (before estimation)

Before we run the estimator, we add **average stats per period** for each team and each period_id. The snapshot columns are **sums** (cumulative or per-period totals), so we derive “average in this period” by differencing and dividing by GP in that span.

### Goal

For each team, for each row (each `scoring_period_id`), add columns that are the **average stats in that period** (e.g. avg_pts_in_period, avg_reb_in_period, …). So every team gets one row per period_id it has, and each row gets new columns: average of each stat over the games played in that period.

### How to compute (do not assume consecutive period_ids)

- **Per team:** Sort rows by `scoring_period_id`. For each row (current period_id), we need the **previous** period_id for that same team (the last period we have before the current one). Period IDs may not be consecutive (e.g. one period can be missing), so we do **not** assume current = i and previous = i−1; we use the actual previous period_id in the data.
- **Sums in this period:** For each sum column (e.g. pts, reb, fgm, fga, ftm, fta, three_pm, ast, stl, blk):
  - `sum_at_current` = value at current row  
  - `sum_at_previous` = value at the row with the previous period_id (for that team)  
  - `delta_sum` = sum_at_current − sum_at_previous`  
  That is the total of that stat in the current period.
- **Games played in this period (N):**  
  - `gp_at_current`, `gp_at_previous` from the `gp` column  
  - `delta_gp` = gp_at_current − gp_at_previous  
  That is the number of games played between the previous and current period_id. **Add a column** for this (e.g. `gp_in_period` or `n_games_in_period`) — this is the **N** we use when we calculate the averages.
- **Average in this period:**  
  - `avg_stat_in_period` = delta_sum / delta_gp when delta_gp > 0.  
  - If delta_gp == 0 (or no previous period), we can leave the new column NaN or 0 (to be defined).
- **New columns to add:**  
  - One column: **games played in that period** = `delta_gp` (the N for the averages).  
  - For each sum stat we care about (e.g. fgm, fga, ftm, fta, three_pm, reb, ast, stl, blk, pts): one column = **average in that period** = delta_sum / delta_gp (e.g. `avg_pts_in_period`, `avg_reb_in_period`, …).

### Summary

- **Input:** Snapshot with rows per (team_id, scoring_period_id), columns = sums (+ gp, etc.).
- **Output:** Same rows, plus new columns:
  - **gp_in_period** (or similar): number of games played in that period_id = delta_gp (the N we divide by).
  - **avg_*_in_period** for each stat: average in that period = delta_sum / delta_gp.
  Previous period = actual previous period_id in the data (not i−1).
- **Edge case:** First period for a team (no previous row): no delta; new columns can be NaN or we skip that row for “average in period” (or use that row’s sum/gp as the “average” for that single period—to be decided).

---

## Processing steps (estimation)

*(To be filled in when you provide the processing.)*
