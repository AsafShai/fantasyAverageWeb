# Dynamic categories: DB migration plan

## Status

Not started. This is a plan document only — no code or schema changes yet.
Written after the "dynamic categories" PR stack (#203–#213), which made the
**live-ESPN** path (current rankings, league summary, team detail, heatmap,
player rankings) read the league's actual scoring categories instead of a
hardcoded 8. This document covers the piece that stack deliberately left out:
the **DB-backed path** (date-range history, and the Estimator, which is built
on the same tables).

## Why this is a separate, harder problem

The live-ESPN path builds DataFrames on the fly from whatever ESPN returns, so
adding a column for a new category is just "keep it if present." The DB path
is different: `team_daily_snapshot`, `team_rankings_averages`, and
`team_rankings_totals` are Postgres tables with **one column per category**,
fixed at schema-design time:

```sql
-- team_daily_snapshot
gp, fgm, fga, fg_pct, ftm, fta, ft_pct, three_pm, reb, ast, stl, blk, pts

-- team_rankings_averages / team_rankings_totals
rk_fg_pct, rk_ft_pct, rk_three_pm, rk_reb, rk_ast, rk_stl, rk_blk, rk_pts, rk_total
```

A league that scores turnovers has nowhere to put a TO value in these tables
today. Anything reading from them (`_get_rankings_for_range`,
`_get_heatmap_for_range` in `ranking_service.py`/`league_service.py`, and all
of `fantasy_estimator/`) is permanently stuck on the fixed 8 until this is
fixed, regardless of what's done on the live-ESPN side.

## Chosen approach: EAV-style category table

Reject a "keep adding nullable columns per category" approach — it doesn't
scale (every new category across every league needs a migration) and every
query has to know the fixed column list anyway, which is the exact problem
we're trying to leave behind.

Instead, add one generic table that stores one row per
(team, scoring_period, category):

```sql
CREATE TABLE team_category_snapshot (
    league_id BIGINT NOT NULL,
    season_id INT NOT NULL,
    scoring_period_id INT NOT NULL,
    date DATE NOT NULL,
    team_id INT NOT NULL,
    team_name TEXT NOT NULL,
    category TEXT NOT NULL,       -- 'PTS', 'FG%', 'TO', ...
    value DOUBLE PRECISION NOT NULL,
    rank INT,                     -- team's rank-in-category for this period (nullable: totals snapshot doesn't need it)
    PRIMARY KEY (league_id, season_id, scoring_period_id, team_id, category)
);

CREATE INDEX idx_team_category_snapshot_lookup
    ON team_category_snapshot (league_id, season_id, team_id, date);
```

This single table replaces the per-category columns in all three existing
tables. `gp` stops being special-cased — it's stored as just another
`category = 'GP'` row (already true conceptually: `RANKING_CATEGORIES + ['GP']`
is a pattern used throughout the live-ESPN work).

`fgm`/`fga`/`ftm`/`fta` (raw counting stats behind FG%/FT%) still need
storage for the totals-snapshot use case (`upsert_daily_snapshot` currently
stores these alongside `fg_pct`/`ft_pct` so `raw_standings_to_totals_df`-style
consumers can recompute). Store them the same way, as their own category rows
(`category IN ('FGM','FGA','FTM','FTA')`), not specially. Frontend/backend
code already treats FGM/FGA/FTM/FTA as excluded from `RANKING_CATEGORIES` (see
`PERCENTAGE_CATEGORIES`/`NON_RANKING_STAT_KEYS` in the live-ESPN work) so no
new exclusion concept needed.

## Migration steps

1. **Add the new table** (`migrations/add_team_category_snapshot.sql`),
   additive only — do not touch the existing three tables yet. Deploy this
   alone first; nothing reads from the new table, so this step is a pure
   no-op in production.
2. **Dual-write**: update `db_service.upsert_daily_snapshot`,
   `upsert_rankings_averages`, `upsert_rankings_totals` to also insert into
   `team_category_snapshot`, using whatever category list `DataProvider`
   resolved for that snapshot (the same `get_ranking_categories()` /
   `get_reverse_categories()` already built by #204/#210). Keep the old
   writes too, unchanged. Ship this, let it run for at least one full
   in-season data-collection cycle so `team_category_snapshot` has real
   history before anything depends on it. Verify parity: for the existing 8
   categories, values in the new table must exactly match the old columns
   for the same team/period.
3. **Migrate reads**, one call site at a time, each as its own PR, each with
   the same "real end-to-end test against a turnovers-scoring league" bar
   used throughout the #203–#213 stack:
   - `db_service.get_latest_snapshot` (DB fallback when ESPN is down)
   - `db_service.get_snapshots_for_date_range` (`_get_rankings_for_range`,
     `_get_heatmap_for_range`)
   - `fantasy_estimator/` (see the note below — larger, separate effort)
4. **Backfill historical data** for leagues/seasons where the old tables have
   rows but `team_category_snapshot` doesn't (anything written before step 2
   shipped). A one-off script reading the three old tables and writing
   equivalent `team_category_snapshot` rows, run once per environment.
5. **Drop the old columns**, only after every reader has been migrated and a
   full season's worth of dual-written data confirms parity. Keep the three
   old tables' `(league_id, season_id, scoring_period_id, team_id)` identity
   columns (still useful for e.g. team names); drop only the per-category
   columns, or drop the tables entirely if `team_category_snapshot` fully
   replaces them (team_name would need to move into the new table, or a
   small `team_snapshot_meta` table keyed the same way).

## Query shape after migration

Reading "this team's PTS and TO for scoring period 12" changes from:

```sql
SELECT pts FROM team_daily_snapshot WHERE ... AND team_id = $1
```

to:

```sql
SELECT category, value FROM team_category_snapshot
WHERE ... AND team_id = $1 AND category = ANY($2)  -- $2 = resolved categories list
```

then pivoted back into a wide DataFrame in Python (one `pivot` call), which is
exactly the DataFrame shape `data_transformer.py`'s functions already expect
— so `calculate_rankings`, `normalize_for_heatmap`, etc. need no changes once
the DB layer hands them a DataFrame in the same shape it does today.

## What's explicitly out of scope here

- **The Estimator's Monte Carlo simulation** (`fantasy_estimator/`). Even
  after this migration gives it a place to store/read an arbitrary category,
  the simulation math itself (`_run_monte_carlo_ranking`'s fixed `(n_teams, 8)`
  array, the hardcoded FG%/FT% "impact" treatment, `STAT_NAMES` in
  `column_names.py`) needs its own follow-up work to generalize. This
  migration is a prerequisite for that work, not a replacement for it.
- **H2H / points-league scoring formats.** Nothing here touches how a score
  is computed from category values — only how per-category values are
  stored. Out of scope, as with the rest of the #203–#213 stack.

## Effort estimate

Medium: the schema change and dual-write are mechanical and low-risk (steps
1–2). The real cost is migrating readers one at a time with real testing
(step 3) plus the backfill (step 4) — comparable in size to two or three of
the PRs in the #203–#213 stack. Budget the Estimator's own generalization
separately; it's the larger, harder piece.
