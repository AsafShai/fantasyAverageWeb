# Fantsy Estimator

Fantasy NBA season estimator: predicts end-of-season stats per team, their variance, and uses Monte Carlo simulation to rank teams and estimate the probability each team finishes in each place.

## Logic (high level)

1. **Input**: A `team_daily_snapshot` DataFrame: one row per team per date, with cumulative stats (gp, fgm, fga, ftm, fta, three_pm, reb, ast, stl, blk, pts) and scoring period.

2. **Preprocess**: Rows are grouped by team and scoring period. For each period we compute delta stats and per-game averages (`avg_*_in_period`). Teams with too few periods are skipped.

3. **Window estimation (per team)**  
   For each team we fit a **windowed mean and covariance** over recent periods (with decay so the latest window matters most). This gives:
   - A 10‑dim **mean** of “remaining season totals” (fgm, fga, ftm, fta, three_pm, reb, ast, stl, blk, pts).
   - A 10×10 **covariance** of those totals (uncertainty and correlations).

4. **Projected games and scaling**  
   From current GP and NBA average pace we get **projected_total_gp** and **remaining_games**. We scale the window mean/cov by remaining games and combine with current cumulative state to get **estimated final** totals. For FG% and FT% we use the ratio (FGM/FGA, FTM/FTA) and the **delta method** for variance (with correlation).

5. **Output table 1 — team_prediction**  
   One row per team: identity, `as_of_date`, `projected_total_gp`, **estimated_final_*** and **variance_*** for each of the 8 stats (fg_pct, ft_pct, three_pm, reb, ast, stl, blk, pts), plus `nba_avg_pace`.

6. **Monte Carlo ranking**  
   We treat each team’s remaining totals as a 10‑dim normal N(mean_10, cov_10). We draw many runs. In each run we convert to the 8 stats (including fg_pct = fgm/fga, ft_pct = ftm/fta), rank teams per stat (1st = N points, last = 1), sum points per team, and record each team’s **final rank** (1..12). We average over runs to get expected points per stat and the distribution of final rank.

7. **Output table 2 — team_ranking**  
   One row per team: **expected_pts_*** per stat, **total_expected_pts**, and **rank** (1 = best by total expected points).

8. **Output table 3 — team_rank_probability**  
   One row per team: **prob_rank_1** … **prob_rank_12** = probability that team finishes in that place (by total points in the Monte Carlo runs).

---

## The three output tables

### 1. `team_prediction`

**Purpose**: Phase 1 predictions — estimated end-of-season value and variance for each stat, per team.

| Concept | Columns |
|--------|---------|
| Identity | `run_id`, `team_id`, `team_name` |
| Snapshot | `as_of_date`, `projected_total_gp` |
| Estimated finals | `estimated_final_fg_pct`, `estimated_final_ft_pct`, `estimated_final_three_pm`, `estimated_final_reb`, `estimated_final_ast`, `estimated_final_stl`, `estimated_final_blk`, `estimated_final_pts` |
| Variance | `variance_fg_pct`, `variance_ft_pct`, … (same 8 stats) |
| Meta | `nba_avg_pace`, `created_at` |

One row per team per run. Unique on `(run_id, team_id)`.

---

### 2. `team_ranking`

**Purpose**: Monte Carlo ranking — expected ranking points per stat and total, and the resulting rank (1 = best).

| Concept | Columns |
|--------|---------|
| Identity | `run_id`, `team_id`, `team_name` |
| Rank | `rank` (1-based, by total_expected_pts) |
| Games | `projected_total_gp` |
| Expected points per stat | `expected_pts_fg_pct`, `expected_pts_ft_pct`, `expected_pts_three_pm`, `expected_pts_reb`, `expected_pts_ast`, `expected_pts_stl`, `expected_pts_blk`, `expected_pts_pts` |
| Total | `total_expected_pts` |
| Meta | `created_at` |

One row per team per run. Unique on `(run_id, team_id)`.

---

### 3. `team_rank_probability`

**Purpose**: Probability that each team finishes in each place (1st, 2nd, …, 12th) based on total ranking points in the Monte Carlo runs.

| Concept | Columns |
|--------|---------|
| Identity | `run_id`, `team_id`, `team_name` |
| Probabilities | `prob_rank_1`, `prob_rank_2`, …, `prob_rank_12` (sum to 1 per team) |
| Meta | `created_at` |

One row per team per run. Unique on `(run_id, team_id)`.

---

## Usage

```python
from fantsy_estimator import FantasyEstimator

estimator = FantasyEstimator()
# df: team_daily_snapshot with columns per TeamDailySnapshotColumns
predictions_df, ranking_df, rank_prob_df = estimator.estimate(df, nba_avg_pace=65.9)
# predictions_df → team_prediction table
# ranking_df    → team_ranking table
# rank_prob_df  → team_rank_probability table
```

SQLAlchemy models and PostgreSQL DDL for these three tables live in `fantsy_estimator/output_tables/`.
