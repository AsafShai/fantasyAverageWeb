# Feature History

Implementation notes for completed features. Moved out of `CLAUDE.md` so they aren't loaded into every session — read the relevant entry when touching that area.

## **Opponent Matchup Quality** (**merged to master** — verified 2026-07-03, `git log master..feat/opponent-matchup-quality` empty)

**Feature flag:** `VITE_FF_MATCHUP_QUALITY=true` in `.env.local` locally. On prod only if the var is set in Render env — verify there before assuming it's visible to users.

What it does: for each rostered player with a game tonight, shows how their opponent defends each roto stat category (rank 1–30, 30 = worst defense = best matchup) plus actual per-game values the opponent allows and a pace indicator.

- **GET /api/matchups/today** — `backend/app/routes/matchups.py`. Optional `?date=YYYYMMDD` for historical testing.
- **NbaMatchupService** — `backend/app/services/nba_matchup_service.py`. Single `_ensure_def_cache()` fetches both opponent stats and advanced stats in one nba_api call. `get_all_def_data()` returns ranks, def_values, league_avg_def_values, pace.
- **Response shape:** `player_name`, `pro_team`, `opponent`, `pace`, `league_avg_pace`, `positions`, `def_ranks` (7 ints), `def_values` (7 floats), `league_avg_def_values` (7 floats). No `pace_badge` — frontend computes Fast/Avg/Slow (±2.0 threshold).
- **Best-cat badge** — weighted by player strength: `score = (player_pg / league_benchmark) × (def_rank / 30)`. Highest score wins. Falls back to plain highest-rank if no player stats provided.
- **MatchupCell** (collapsed): `vs OPP | BestCat badge | ▼`. **MatchupExpandRow** (expanded): 8-cell grid — 7 stat cells (rank + actual value) + PACE block.
- **Expand row mobile fix:** `position: sticky; left: 0` on `.mq-expand-content` so content stays visible regardless of horizontal scroll position.
- **Key files:** `frontend/src/components/MatchupDisplay.tsx`, `frontend/src/components/MatchupDisplay.css`, `frontend/src/config/featureFlags.ts`, `frontend/src/types/api.ts`
- **Column position:** last column in both Players and TeamDetail tables.

## **ESPN Whitelist-Calendar Schedule Redesign** (branch: `feat/espn-whitelist-calendar`)

Replaced whole-month scoreboard scanning with ESPN's `?calendartype=whitelist` calendar (one request, ~229 season-long game dates) to find which days actually have games, then fetches only those specific days — never a whole month just to answer "what's the next slate."

- **`model_stats_inference/espn/client.py`** — added async twins of the sync ESPN client (`async_get_json`, `scoreboard_async`, `calendar_whitelist_async`), sharing `BASE`/`HEADERS`/`RETRY_DELAYS`/`EspnUnavailableError` with the sync nightly-ingest path instead of duplicating them. No pacing sleep on the async path (that's for the nightly bulk pull's hundreds of sequential requests, not a handful of per-request lookups).
- **`NbaMatchupService`** — `_ensure_whitelist()` caches the whitelist calendar 24h (parsed to ET `date`s via `datetime.fromisoformat(s.replace('Z','+00:00')).astimezone(ZoneInfo('America/New_York')).date()` — ESPN's calendar entries are ISO datetimes like `"2025-10-02T07:00Z"`, not plain dates). `_countable_events_by_day()` walks whitelist candidates in the requested range and fetches only those days; empty candidates (offseason) short-circuits to zero day-scoreboard calls.
- **Cache merge:** the old `_schedule_cache`/`_upcoming_cache` (two independent 5-min TTLs over overlapping data) are now one `_events_cache` that both `get_games_today` and `get_upcoming_game_dates` read from — a page load calling both (as `/today`'s route does via `_known_slate_dates`) no longer double-fetches the overlapping date range.
- No public API changes — `backend/app/routes/matchups.py`, `GameInfo`, `get_schedule_date()` contract unchanged.
- Plan: `docs/superpowers/plans/2026-07-18-espn-whitelist-calendar.md`.

## **Player Rankings Page Improvements** (branch: `feat/player-rankings`)
- `minMin` filter changed from season total minutes to MPG (per game): `minutes / gp`
- MPG column added to rankings table (next to GP)
- Reset button restores all filters + weights to defaults
- `minGp`, `minMin`, `position` now apply instantly as display filters on already-ranked list — no Calculate needed; z-scores from last calc stay intact
- All table columns now sortable on click: GP, MPG, each raw stat, each z-score
- `SortCol` type extended to `'totalZ' | 'gp' | 'mpg' | RankingCategory | \`${RankingCategory}_raw\``
- Key files: `frontend/src/pages/PlayerRankings.tsx`, `frontend/src/utils/playerRankings.ts`

## **Depth Chart Client-Side Filters** (branch: `feat/depth-chart-client-filters`)
- Two new filter checkboxes on the depth chart UI: "Hide injured (Out)" and "Remove duplicate positions"
- Top-5-per-position cap moved entirely to frontend so filters apply before capping
- Deduplication logic: each player kept only in their highest-priority position (lowest rank index)
- Filters reset when switching teams
- New utility: `frontend/src/utils/depthChartFilters.ts`

## **Persistent Injury Status via DB** (same branch)
- `player_injury_status` table in Neon PostgreSQL — migration at `backend/migrations/create_injury_status_table.sql`
- DB is seeded via `backend/seed_injury_db.py` (run locally before deploy — fetches last 3 days of 4 PM ET PDFs)
- Depth chart now queries DB for injury statuses so all teams show correctly, even on off-days
- Scheduler writes to DB only on actual status changes (added / status_change / removed)
- Explicit removal logic: if a team submits their report and a tracked player is absent → delete from DB + notification
- In-memory `injury_store` remains PDF-only (injury page); DB is the persistent source for depth chart
- TTL/prune logic removed — replaced by explicit removal

## **MCP Server Removed from Backend**
- `fantasy-nba-israel-mcp` dependency and `/mcp` mount removed from `backend/app/main.py` and `backend/pyproject.toml`
- `fantasynbaleague-local` entry removed from `C:\Users\asafh\.cursor\mcp.json`
