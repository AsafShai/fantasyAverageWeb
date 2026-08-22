# Dynamic categories: DB migration plan

## Status

Not started. This is a plan document only — no code or schema changes yet.
Written after the "dynamic categories" PR stack (#203–#214), which made the
**live-ESPN** path (current rankings, league summary, team detail, heatmap,
player rankings) read the league's actual scoring categories instead of a
hardcoded 8. This document covers the piece that stack deliberately left out:
the **DB-backed path** (date-range history, Standings Race, and the Estimator,
which is built on the same tables).

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
today. Anything reading from them is permanently stuck on the fixed 8 until
this is fixed, regardless of what's done on the live-ESPN side:

- `_get_rankings_for_range` (`ranking_service.py`) — date-range rankings
- `_get_heatmap_for_range` (`league_service.py`) — date-range heatmap
- `get_rankings_over_time` (`db_service.py`) — **Standings Race**, which
  selects `rk_fg_pct … rk_pts, rk_total` by name
- all of `fantsy_estimator/`

Standings Race is the one users would notice first: it would plot an
8-category `rk_total` while the live Rankings page beside it shows a
9-category total. Two different numbers for "total points", disagreeing, with
nothing on screen explaining why.

## The constraints that pick the design

Two limits drive this, and they point in different directions than they
first appear:

- **Storage** — Neon free tier. Worth measuring rather than fearing: one
  league is 12 teams × ~174 scoring periods = **2,088 team-period rows per
  season**. Every option below is small in absolute terms.
- **Latency** — Render free tier with cold starts. This is the binding
  constraint. Standings Race pulls a full season's time series (every team,
  every date) on one request.

| approach | rows/season | storage/season | Standings Race rows fetched |
|---|---|---|---|
| today (fixed columns) | 2,088 | ~0.35 MB | 2,088 |
| EAV (row per category) | 27,144 | ~4.9 MB | 27,144 |
| **JSONB column** | 2,088 | ~0.95 MB | 2,088 |

EAV's ~5 MB/season is ~1% of a 0.5 GB tier — storage is not what rules it
out. The 13× read amplification on every date-range and time-series query is,
plus a pivot back to wide in Python on each request.

## Chosen approach: a JSONB column on the existing tables

Do not create a new table. Add a column.

```sql
ALTER TABLE team_daily_snapshot    ADD COLUMN stats JSONB;
ALTER TABLE team_rankings_averages ADD COLUMN ranks JSONB;
ALTER TABLE team_rankings_totals   ADD COLUMN ranks JSONB;
```

`stats` holds one object per team-period, keyed by category code:

```json
{"GP": 47, "PTS": 1120, "REB": 400, "TO": 120, "FGM": 380, "FGA": 810, "FG%": 0.469}
```

`gp` stops being special-cased — it is just another key, as
`RANKING_CATEGORIES + ['GP']` already treats it throughout the live-ESPN work.
`FGM`/`FGA`/`FTM`/`FTA` are stored the same way, as ordinary keys; the
existing `PERCENTAGE_CATEGORIES` / `NON_RANKING_STAT_KEYS` constants already
express which keys are not ranking categories, so no new exclusion concept is
needed.

### Why this over EAV

- **Row count is unchanged.** Every query fetches exactly as many rows as it
  does today. No read amplification anywhere.
- **No pivot.** The row already carries every category, so
  `{**base, **row['stats']}` yields the wide DataFrame shape
  `data_transformer.py` already expects. EAV needs a pivot per request; this
  needs nothing.
- **Index is unchanged.** Same btree on `(league_id, season_id, team_id, date)`.
  No new primary key, no `category = ANY($2)` predicate to plan around.
- **No flag day.** Readers prefer the JSONB when non-null and fall back to the
  fixed columns otherwise, so old rows keep working untouched and each reader
  migrates on its own schedule.
- **`team_name` stays where it is.** EAV would duplicate it 13× per period or
  force a separate `team_snapshot_meta` table.
- **Precedent in this repo.** `fs_player_vectors.features JSONB` already
  stores a variable set of named numeric features, written with `$8::jsonb`
  and introspected with `jsonb_object_keys` (`db_service.py`). Same problem
  shape, already in production here.

### Why not MongoDB

Considered and rejected. The schemaless part of this problem is **one field** —
the category map. Everything around it (league/season/period/team identity,
the `LEFT JOIN team_daily_snapshot` that supplies `gp` to the rankings
time-series query) is fixed-schema relational data that Postgres is already
serving. Mongo would mean a second datastore, a second connection pool, a
second free tier to watch, and app-side joins, in exchange for flexibility
Postgres already provides in `jsonb`. Atlas's free tier (512 MB) is not a
storage win either. Migrating `db_service.py` — plus the estimator tables,
feature store, and injury tables — would dwarf the change being contemplated.
A document store would be the right call for a greenfield, join-free,
document-shaped app. This is not that.

## Migration steps

1. **Add the columns** (`migrations/add_dynamic_category_columns.sql`).
   A nullable `ADD COLUMN` is metadata-only on PG 11+ — no table rewrite,
   instant, safe on a live table. Nothing reads it yet, so this deploys as a
   pure no-op.
2. **Dual-write.** Update `upsert_daily_snapshot`, `upsert_rankings_averages`,
   `upsert_rankings_totals` to write the JSONB alongside the existing fixed
   columns, using whatever category list `DataProvider` resolved for that
   snapshot (`get_ranking_categories()` / `get_reverse_categories()`, already
   built by #204/#210). Keep the old writes unchanged. Verify parity: for the
   existing 8 categories, JSONB values must match the old columns exactly for
   the same team/period.
3. **Migrate reads**, one call site per PR, each preferring the JSONB when
   non-null and falling back to the fixed columns. The fallback means there is
   no ordering constraint between these, and no reader is ever broken by a row
   written before step 2:
   - `get_latest_snapshot` (DB fallback when ESPN is down)
   - `get_snapshots_for_date_range` (`_get_rankings_for_range`,
     `_get_heatmap_for_range`)
   - `get_rankings_over_time` (Standings Race)
   - `fantsy_estimator/` (see below — larger, separate effort)
   Each gets the same "real end-to-end test against a turnovers-scoring
   league" bar used throughout the #203–#214 stack.
4. **Backfill.** Two independent cases:
   - *Existing categories, old rows*: one `UPDATE ... SET stats =
     jsonb_build_object('PTS', pts, 'REB', reb, ...)`. Pure SQL, no external
     calls, run once per environment.
   - *A category added to the league mid-season*: fetch per scoring period
     from ESPN and merge into the existing rows with
     `stats = stats || jsonb_build_object('TO', …)`. Merging into existing
     rows is why no new rows are needed for a late-added category.
5. **Drop the fixed columns** — optional, and probably never worth doing.
   They cost ~0.25 MB/season and keep every existing query valid, including
   the hand-written SQL in `get_rankings_over_time`. Revisit only if the
   duplication becomes a correctness hazard.

## Query shape after migration

Reading "this team's PTS and TO for scoring period 12" changes from:

```sql
SELECT pts FROM team_daily_snapshot WHERE ... AND team_id = $1
```

to:

```sql
SELECT stats FROM team_daily_snapshot WHERE ... AND team_id = $1
```

— same row, same index, same plan. Widening in Python is a dict merge, not a
pivot, so `calculate_rankings`, `normalize_for_heatmap` and friends need no
changes once the DB layer hands them the shape it does today.

## Implementation gotchas

- **asyncpg returns JSONB as `str`, not `dict`.** No codec is registered
  anywhere in `db_service.py` today, and nothing currently reads `features`
  back into Python, so this is untested ground in this repo. Register it once
  at pool creation via `create_pool(init=...)` calling
  `set_type_codec('jsonb', encoder=json.dumps, decoder=json.loads,
  schema='pg_catalog')`, rather than scattering `json.loads` across call sites.
- **`NaN` is not valid JSON.** `json.dumps(float('nan'))` emits bare `NaN` and
  Postgres rejects it with `invalid input syntax for type json`. The estimator
  produces `np.nan` (`ratio_mean` on zero attempts) and the transformers
  `.fillna(0)` on some paths but not all. Convert `NaN`/`inf` to `None` before
  serializing.
- **numpy scalars are not JSON-serializable.** Every value off a DataFrame is
  an `np.float64`/`np.int64`, and `json.dumps` raises `TypeError` on them.
  Cast with `float(...)`/`int(...)` when building the dict, as the response
  builders already do.
- **Do not add a GIN index on the JSONB.** It is the reflexive move with
  `jsonb` and it is wrong here: GIN serves searching *inside* the document,
  which this access pattern never does. Every read is by the existing btree
  key. The index would cost more than the column it indexes.
- **JSONB numbers are stored as `numeric`**, exact base-10 decimal rather than
  IEEE-754 `float8`. Precision is better than a `DOUBLE PRECISION` column, not
  worse, and `json.loads` hands Python a normal `float`. The cost is variable
  width (~10 bytes for `0.469` vs a flat 8) and slower arithmetic — irrelevant
  here, since all math happens in pandas, not SQL. Noted so a later benchmark
  against the old wide table doesn't read as a regression.

## What's explicitly out of scope here

- **The Estimator's Monte Carlo simulation** (`fantsy_estimator/`). This
  migration is a prerequisite for generalizing it, not a replacement. Two
  further pieces of work remain after it:
  - Its own three output tables (`team_prediction`, `team_ranking`,
    `team_rank_probability`) have the same one-column-per-stat shape and need
    the same JSONB treatment.
  - The simulation math is welded to two coupled constants:
    `pts_accum = np.zeros((n_teams, 8))` for derived ranking stats and
    `samples_10 = np.zeros((n_teams, 10))` for the raw sampled quantities the
    covariance is built at, related by FG%/FT% collapsing four raw columns
    into two. Adding a category shifts both plus every positional index
    between them. The `(fgm/fga, ftm/fta)` special-casing needs to become a
    declared "this category is a ratio of these two raw quantities" mapping —
    the same concept `ATTEMPT_KEY` (frontend) and `PERCENTAGE_CATEGORIES`
    (backend) already encode, so there is a shared abstraction to lift rather
    than a third copy to write.
  - `_run_monte_carlo_ranking` also ranks with an unconditional
    `rank(ascending=False)` — the same defect #210 fixed in
    `calculate_rankings`. Harmless until a reverse-scored category can reach
    the estimator, and not meaningfully fixable before then.
- **H2H / points-league scoring formats.** Nothing here touches how a score is
  computed from category values — only how per-category values are stored. Out
  of scope, as with the rest of the #203–#214 stack.

## Effort estimate

Small-to-medium, and materially smaller than the EAV design this replaces.
Steps 1–2 are mechanical and low-risk. Step 3 is the real cost, but the
fixed-column fallback means each reader is an independent, individually
shippable PR with no flag day and no backfill dependency. Step 4 is one SQL
statement for the common case. Budget the Estimator's own generalization
separately; it remains the larger, harder piece.
