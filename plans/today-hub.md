# Today Hub — Dashboard rebuild

Branch: `feat/today-hub` · Mockup: `plans/today-hub-mockup.html`

## Goal
Replace the Dashboard's static league-averages grid with "what changed since yesterday": rank movers, roster injury impact per fantasy team, tonight's game counts per fantasy team. Keep DeadlineCountdown and Top-5. No new external data.

## Data already available
- Rank deltas: `team_rankings_averages` has one row per team per scoring period (`rk_*`, `rk_total`, `ranks` JSONB). Yesterday = `MAX(scoring_period_id)`, day before = `MAX-1`. Read via `DBService.get_rankings_over_time` or a new narrow query.
- Roster injuries: `injury_service.injury_store` (team, player, status) × `DataProvider.get_players_df(0)` (`Name`, `fantasy_team_name`, `Pro Team`). Join on `normalize_player_name`.
- Tonight's games: `NbaMatchupService.get_games_today()` → `{pro_team_abbr: GameInfo}`. Count rostered players whose `Pro Team` is in the map.

## Backend
- New route `GET /api/league/today` → `TodayHub` model (`models/league.py`):
  - `slate_date: date | None`
  - `movers: list[{team_id, team_name, category, delta}]` — top 8 by |delta|, category `TOTAL` allowed; deltas from the two latest periods. Empty list when fewer than 2 periods exist.
  - `roster_health: list[{team_id, team_name, out, questionable, playing_tonight, roster_size}]`
  - `last_nightly: {game_date, rows} | None` from `model_nightly_runs` (latest row). Small, cheap, optional.
- New service `services/today_service.py` composing the three sources with `asyncio.gather`; each part fail-open (empty) so one missing source doesn't 503 the hub.
- `DBService`: add `get_latest_two_periods_rankings(league_id, season_id)` returning rows for the two highest periods only (single query, `WHERE scoring_period_id IN (max, max-1)`).
- Cache the composed response 5 min in-process (same pattern as `_response_cache` in `routes/matchups.py`).

## Frontend
- `fantasyApi.ts`: `getTodayHub` query, `keepUnusedDataFor: 300`.
- `pages/Dashboard.tsx`: new layout per mockup — countdown on top, three panels (Movers / Roster health / Tonight), then the existing league-average tiles as one compact row (keep all 9 values: GP, FG%, FT%, 3PM, AST, REB, STL, BLK, PTS plus NBA pace / game days left / total teams — smaller tiles, same data), then Top-5. Owner decision 2026-09-18: averages must stay on the Dashboard.
- Movers: top 8 by |delta| on desktop, top 5 on mobile with a "Show all" toggle.
- Panels are small components in `components/today/`: `RankMovers.tsx`, `RosterHealth.tsx` (row click → `/team/:id`), `TonightStrip.tsx`.
- Mobile: panels stack (`grid-cols-1 md:grid-cols-3`), tables use `text-xs sm:text-sm`.
- Dark mode: rely on existing `.dark .bg-white` overrides; use semantic chip classes with `dark:` variants.

## Tests
- Backend: `tests/services/test_today_service.py` — movers from two synthetic periods; roster health join with a mocked `injury_store`; fail-open when a source raises.
- Frontend: `Dashboard.test.tsx` renders panels from a fixture; empty-state text when `movers` is `[]` (first day of season).

## Verification
- Local: `uv run uvicorn app.main:app --reload`, `curl /api/league/today`, check timings < 300 ms warm.
- Mobile check at 390 px via `mobile-check` skill.

## Risks
- Early season: only one period → movers empty; show "Movers appear after day 2".
- Offseason: `slate_date` None → Tonight panel shows "No games scheduled".
