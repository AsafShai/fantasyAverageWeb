# Test Priority Areas

Load this when producing a coverage report so the risk ranking reflects project-specific concerns.

## Tier 1 — highest risk (cover first)
- **Routes that write to DB** — snapshot writes, injury-status upserts/deletes, any POST/PUT/DELETE route.
- **`snapshot_service.py`** — daily persistence, constraint handling, idempotency.
- **`injury_service.py`** — PDF parsing. Format has changed before; regressions are silent until the scheduler runs.

## Tier 2 — core logic
- **`nba_stats_service.py`** — per-player stat calculations, averaging, category totals, period filtering.
- **`team_service.py`** — slot usage, roster composition.
- **`data_transformer.py`** — ESPN payload shaping. Protects against ESPN drift.

## Tier 3 — integration boundaries
- **`data_provider.py`** — ETag cache behavior, stale handling.
- **`builders/response_builder.py`** — shape correctness.

## Tier 4 — lower priority
- Read-only simple routes that just delegate to a service
- Pure utility functions with obvious logic

## Edge cases to always look for
- ESPN null for players who didn't play → must not coerce to 0
- Empty lists (no games, no roster)
- Missing fields (ESPN silently drops)
- `scoring_period_id=0` (season-to-date) semantics
- DB constraint violations (duplicate inserts, FK failures)
