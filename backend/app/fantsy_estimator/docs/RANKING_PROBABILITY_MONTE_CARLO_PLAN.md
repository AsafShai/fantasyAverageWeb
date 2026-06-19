# Plan: Ranking probability via Monte Carlo (second output table)

## Goal

1. **Config**: Add `num_monte_carlo: int = 1000`.
2. **Monte Carlo**: For each run, sample each team’s season totals from their predicted mean and covariance; rank teams per stat; assign points (1st = N, 2nd = N−1, …, last = 1 for N teams). Average points per (team, stat) over runs → **expected points per stat**.
3. **Second table**: One row per team with `team_id`, `team_name`, and for each of the 8 stats an **expected_pts_<stat>** column (and optionally `total_expected_pts`).
4. **Estimator return**: `estimate()` returns `tuple[pd.DataFrame, pd.DataFrame]`: (team_predictions_df, ranking_expected_pts_df).

---

## 1. Config

**File**: [fantsy_estimator/configuration/fantasy_configuration.py](fantsy_estimator/configuration/fantasy_configuration.py)

- Add `num_monte_carlo: int = 1000` to `FantasyConfiguration.__init__` and store as `self.num_monte_carlo`.

---

## 2. Data needed for Monte Carlo

We need per-team **season-total** mean and covariance for the **10 component stats** (fgm, fga, ftm, fta, three_pm, reb, ast, stl, blk, pts) so we can sample and then derive fg_pct = fgm/fga, ft_pct = ftm/fta.

- In `_compute_final_and_variance` we already have:
  - `estimated_final_component` (dict/keyed): 10 totals
  - `full_cov_remaining`: 10×10 covariance of those totals
- We do **not** currently return these from the estimator; we only return the 8 output stats (including the two ratios).

**Change**: When building the per-team result, also keep the 10-dim mean vector and 10×10 covariance matrix (as numpy arrays, same order as `WindowEstimator.stat_columns()`). Options:

- **A)** Have `_estimate_per_team` return a dict that includes internal keys `_mean_10` and `_cov_10` (or a separate return). When building the first DataFrame we drop those keys; when running Monte Carlo we use them from the same list of result dicts.
- **B)** Build a parallel list `mean_cov_list: list[tuple[team_id, mean_10, cov_10]]` alongside `results` (e.g. have `_estimate_per_team` return both the row dict and (mean_10, cov_10)).

Recommendation: **A** — add `_mean_10` and `_cov_10` to the row dict in `_estimate_per_team` (set in `estimate()` after calling `_compute_final_and_variance`, using values from that method). Then in `estimate()` build `predictions_df` from columns that exclude `_mean_10` and `_cov_10`; run MC using the list of result dicts; build ranking_df; return (predictions_df, ranking_df).

To avoid returning internal keys in the public predictions table, we need `_compute_final_and_variance` to **return** the 10-dim mean and 10×10 cov (e.g. as arrays), and `_estimate_per_team` to return the row dict **and** (mean_10, cov_10). Then in `estimate()` we keep two lists: `rows` for the table (no mean/cov) and `mc_data: list[tuple[team_id, team_name, mean_10, cov_10]]` for Monte Carlo. So we need `_compute_final_and_variance` to return (out_dict, mean_10, cov_10) where mean_10/cov_10 are the estimated **totals** (current_state + mean*remaining for components, and full_cov_remaining). And `_estimate_per_team` returns (row_dict, mean_10, cov_10). Then in estimate() we have rows for the first DF and mc_data for MC.

---

## 3. Monte Carlo algorithm

**Inputs**:

- `mc_data`: list of (team_id, team_name, mean_10, cov_10). Order of stats in mean_10 and cov_10: same as `WindowEstimator.stat_columns()` → (avg_fgm_in_period, avg_fga_in_period, …, avg_pts_in_period) as **totals** (we use estimated_final_component and full_cov_remaining).
- `num_runs`: from config (e.g. 1000).
- `stat_cols`: the 10 component names (for indexing).

**Per run**:

1. For each team, sample a 10-dim vector from multivariate normal: `np.random.multivariate_normal(mean_10, cov_10)`. Ensure cov is positive-semidefinite (e.g. add small diag if needed).
2. From the 10 values compute the 8 stats for ranking:
   - fg_pct = fgm / fga (guard fga=0 → e.g. 0 or nan, then skip in rank or use 0)
   - ft_pct = ftm / fta (same)
   - three_pm, reb, ast, stl, blk, pts = the sampled values directly.
3. For each of the 8 stats, rank the N teams (higher is better for all; for fg_pct/ft_pct higher is better). Assign points: 1st = N, 2nd = N−1, …, Nth = 1. (N = number of teams.)
4. Accumulate points per (team_index, stat) in a 2D array.

**After all runs**:

- Average the accumulated points over runs → expected points per (team, stat).
- Build the second DataFrame: one row per team; columns `team_id`, `team_name`, `expected_pts_fg_pct`, `expected_pts_ft_pct`, `expected_pts_three_pm`, `expected_pts_reb`, `expected_pts_ast`, `expected_pts_stl`, `expected_pts_blk`, `expected_pts_pts`, and optionally `total_expected_pts` (sum of the 8).

**Tie-breaking**: If two teams tie on a stat, assign the same rank and then assign points (e.g. average of the positions: if two tie for 2nd, each gets (11+10)/2 = 10.5). Use e.g. `scipy.stats.rankdata(..., method='average')` to get fractional ranks, then map rank to points: points = N + 1 - rank, so 1st → N, last → 1.

---

## 4. Second table: column design

**Table name (logical)**: `team_ranking_expected_pts` or `ranking_expected_points`.

**Columns**:

| Column               | Type   | Description                    |
|----------------------|--------|--------------------------------|
| team_id              | int    | Team identifier                |
| team_name            | str    | Team name                      |
| expected_pts_fg_pct  | float  | Expected points in FG% rank    |
| expected_pts_ft_pct | float  | Expected points in FT% rank    |
| expected_pts_three_pm| float  | Expected points in 3PM rank    |
| expected_pts_reb     | float  | Expected points in REB rank    |
| expected_pts_ast     | float  | Expected points in AST rank    |
| expected_pts_stl     | float  | Expected points in STL rank    |
| expected_pts_blk     | float  | Expected points in BLK rank    |
| expected_pts_pts     | float  | Expected points in PTS rank    |
| total_expected_pts   | float  | Sum of the 8 expected_pts_*    |

No DB/SQLAlchemy model required for now — just a pandas DataFrame returned by the estimator. Column names can be centralized in a small class (e.g. `RankingExpectedPtsColumns`) in `columns/` if we want consistency.

---

## 5. Estimator changes

**File**: [fantsy_estimator/fantasy_estimator.py](fantsy_estimator/fantasy_estimator.py)

1. **`_compute_final_and_variance`**  
   Return `(out, mean_10, cov_10)` where:
   - `mean_10`: 1D array of length 10 (estimated_final_component in order of stat_cols).
   - `cov_10`: 2D array 10×10 (full_cov_remaining in same order).  
   So we need to build `mean_10` and `cov_10` from `estimated_final_component` and `full_cov_remaining` using `stat_cols` order.

2. **`_estimate_per_team`**  
   Call `_compute_final_and_variance` and get `(row, mean_10, cov_10)`. Build the full row dict (add team_id, team_name, nba_avg_pace, as_of_date). Return `(row_dict, mean_10, cov_10)`.

3. **`estimate()`**  
   - Collect `(row_dict, mean_10, cov_10)` per team. Build `predictions_df` from the row_dicts (exclude any internal keys if we added them; currently we don’t add _mean_10 to row_dict, we return them separately). So: `rows = [r for r in row_dicts]` and `mc_data = [(r[team_id], r[team_name], mean_10, cov_10) for ...]`.  
   - Actually: have `_estimate_per_team` return a single dict that includes optional keys `"_mean_10"` and `"_cov_10"`. When building the first DF, use columns that don’t include those. When building MC input, extract them and pop them from the row copy so they don’t appear in the first DF. So one list of dicts; each dict has the row plus _mean_10 and _cov_10; we build predictions_df from columns = out_cols (no _mean_10, _cov_10); we build mc_data from the list by extracting _mean_10, _cov_10.  
   - Simpler: _estimate_per_team returns (row_dict, mean_10, cov_10). We append to results list of dicts (row_dict only) and to mc_list (team_id, team_name, mean_10, cov_10). So two lists.  
   - Implement: `results = []`, `mc_data = []`. In the loop, `row, mean_10, cov_10 = self._estimate_per_team(...)`; `results.append(row)`; `mc_data.append((row[c.TEAM_ID], row[c.TEAM_NAME], mean_10, cov_10))`. Then build predictions_df from results; run `_run_monte_carlo_ranking(mc_data)` → ranking_df; return (predictions_df, ranking_df).

4. **New method `_run_monte_carlo_ranking(self, mc_data: list) -> pd.DataFrame`**  
   Implements the MC algorithm above; returns the second DataFrame with columns team_id, team_name, expected_pts_* for each stat, total_expected_pts.

5. **Return type**  
   `estimate()` returns `tuple[pd.DataFrame, pd.DataFrame]`. If there are no eligible teams, return `(pd.DataFrame(), pd.DataFrame())`.

---

## 6. Sampling details

- **Order of stats** in mean_10 and cov_10: same as `WindowEstimator.stat_columns()`:  
  `avg_fgm_in_period`, `avg_fga_in_period`, `avg_ftm_in_period`, `avg_fta_in_period`, `avg_three_pm_in_period`, `avg_reb_in_period`, `avg_ast_in_period`, `avg_stl_in_period`, `avg_blk_in_period`, `avg_pts_in_period`.  
  These are the **totals** (estimated_final_component and full_cov_remaining).

- **Multivariate normal**: Some covariance matrices can be singular or non-PSD. Add a small diagonal (e.g. 1e-6) to stabilize before sampling if needed.

- **Ratios**: If fga or fta is 0 or negative in a sample, set fg_pct or ft_pct to 0 (or skip that run for that team); or clip the sample. Prefer clipping small values to a tiny positive (e.g. 1e-6) before dividing.

---

## 7. Callers

- **local_run/run_estimator.py**: Update to unpack the tuple:  
  `predictions_df, ranking_df = estimator.estimate(df, nba_avg_pace=NBA_AVG_PACE)`.  
  Print or save both DataFrames (and save both CSVs if we still write to disk).

---

## 8. Summary

| Item | Action |
|------|--------|
| Config | Add `num_monte_carlo=1000` |
| _compute_final_and_variance | Return (out, mean_10, cov_10) |
| _estimate_per_team | Return (row_dict, mean_10, cov_10) |
| estimate() | Build predictions_df; build mc_data; run _run_monte_carlo_ranking(mc_data) → ranking_df; return (predictions_df, ranking_df) |
| _run_monte_carlo_ranking | Sample 10-dim per team per run; derive 8 stats; rank; points; average → expected_pts columns; return DataFrame |
| Columns | Define expected_pts_* and total_expected_pts (e.g. in columns/ or inline) |
| local_run | Handle tuple return, save/print both tables |
