# Project Context (for planning)

Load this when you need the project-specific service map, data flow, or known gotchas during planning. Skip it for trivial changes.

## Backend service map
- `routes/` → thin HTTP layer, delegates to services
- `services/nba_stats_service.py` — per-player stat calculations
- `services/team_service.py` — fantasy team aggregation (slot usage, rosters)
- `services/snapshot_service.py` — daily snapshot persistence to Neon
- `services/injury_service.py` — parses 4 PM ET NBA injury report PDFs
- `services/data_provider.py` — ESPN fetcher with ETag caching
- `services/data_transformer.py` — shapes raw ESPN payloads
- `builders/response_builder.py` — assembles API responses
- `models/` — Pydantic v2 models

## Data flow
ESPN API → `data_provider` (ETag cache) → service → `response_builder` → route → JSON.

DB (Neon asyncpg) participates as:
- write-on-schedule for snapshots
- persistent source for injury status on depth chart (in-memory `injury_store` is PDF-only and ephemeral)

## Frontend
- React + Vite + TypeScript + TanStack Query
- No Redux. Local state + Query only.
- Plain CSS per component
- `utils/depthChartFilters.ts` pattern for client-side filtering
- `TimePeriodSelector` is the standard for scoring-period selection

## Known gotchas to plan around
- ESPN returns null for non-players — code must not coerce to 0
- Trailing-slash redirect on collection routes (`/api/players` vs `/api/players/`)
- ETag cache can serve stale data after DB writes
- `scoring_period_id=0` = "season to date"
- `Player.team` is just `team_id` now, not a nested Team object
- Mobile is a first-class viewport — plan responsive behavior up front
- No SQLAlchemy — use asyncpg raw queries; don't reintroduce ORMs
- Migrations are plain .sql files in `backend/migrations/`, applied manually

## Scope heuristics
- **Small**: single file, < 1 hour
- **Medium**: 2–5 files, ~half a day, one PR
- **Large**: schema change OR both backend + frontend OR >5 files — consider splitting PRs
