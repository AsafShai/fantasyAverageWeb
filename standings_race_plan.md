# Standings Race Chart — Design (idea 8)

> **Asaf 2026-07-11: data = same as Analytics "Rankings by Avg/Totals → Total Score" chart.** This feature is therefore a **presentation upgrade of `RankingsOverTimeChart`**, not a new data feature. Build it as an enhancement to the existing component (or a variant next to it), only if we think it reads better. **Hard requirement: keep the existing dynamic timeframe ability (Brush) exactly as today.** What the new design adds over the current chart:
> 1. Click-to-highlight legend — selected teams full color, rest dimmed (kills the 12-line spaghetti)
> 2. Direct labels at the right edge — no color↔legend lookup
> 3. Bump view toggle — league position 1–12 instead of score
> 4. Sorted crosshair tooltip, day-7 default start
> Mockup saved at repo root: `standings_race_mockup.html`.

Animated/interactive view of roto standings across the whole season. The season's story in one visual — who climbed, who collapsed, when the lead flipped.
Status: design approved-pending. No code yet. 2026-07-11.

## Data — verified 2026-07-11

`team_daily_snapshot` (Neon): **174 scoring periods × 12 teams = 2088 rows, full 2025-26 season**, one row per team per day with cumulative totals: gp, fgm/fga/fg_pct, ftm/fta/ft_pct, three_pm, reb, ast, stl, blk, pts. Written daily by existing scheduler (`db_service.upsert_daily_snapshot`). Zero external calls needed.

## Calc (backend, pandas, one pass)

For each `scoring_period_id`:
1. Rank all 12 teams per category (8 cats: fg_pct, ft_pct, three_pm, reb, ast, stl, blk, pts). Best = 12 roto points, worst = 1. **Ties = average of tied positions** (ESPN roto convention).
2. `roto_points(team, period)` = Σ 8 category points.
3. `rank(team, period)` = position by roto_points (ties → share).

Output series per team: `[{period, date, roto_points, rank, cat_points: {pts: 7.5, reb: 12, ...}}]`.

Notes:
- Early periods (< ~7) noisy — frontend default starts chart at period 7, toggle "from day 1".
- Team renames mid-season: use latest `team_name` per `team_id`.
- GP differences are inherent to cumulative roto — display GP in tooltip for context (ties into GP-adjusted-gap roadmap idea later).

## Endpoint

`GET /api/league/standings-history`
Response: `{periods: [{period, date}], teams: [{team_id, team_name, series: [{period, roto_points, rank}], cat_series available via ?cat=}]}`
- Optional `?cat=reb` → per-category points series instead of total (drives the category selector).
- Season over → fully static: cache aggressively (compute once per process, `cache_manager`). In-season: TTL 1h.

## Frontend

New page `StandingsRace.tsx` (navbar under Tools / behind flag):

1. **Main chart** — Recharts LineChart: X = date, Y = roto points (default) or league rank (toggle; rank view = classic bump chart, Y inverted 1–12).
2. **12 team lines**, distinct colors; click legend item → highlight line, dim others (league has 12 users — everyone finds themselves).
3. **Category selector** — Total (default) + 8 cats: shows that category's roto-points race. This is where stories live ("Oriel's BLK lock from December").
4. **Tooltip** — date, team, roto points, rank, GP.
5. **v2 (not now):** play/replay animation sweeping periods; milestone annotations (trades, injuries); shareable PNG export.

Mobile: ResponsiveContainer, legend as horizontal scroll chips, tooltip tap-friendly, chart min-height ~320px. 12 lines readable on 390px only with highlight interaction — default mobile state dims all until team tapped.

## Tasks (file-level)

### Backend
- [ ] `app/services/league_service.py` (or `stats_calculator.py` — whichever owns roto math today): add `standings_history()` — read snapshots via `db_service`, compute rank/points series, cache
- [ ] `app/services/db_service.py`: add `get_all_snapshots()` read method
- [ ] `app/routes/league.py`: add `GET /standings-history` route (+ optional `?cat=`)
- [ ] `app/models/`: response models
- [ ] tests: tie-handling + known-period ranking against hand-computed fixture

### Frontend
- [ ] `src/pages/StandingsRace.tsx` (new): chart + toggles + legend interaction (Recharts already a dependency)
- [ ] `src/types/api.ts`: types
- [ ] navbar entry behind flag `VITE_FF_RACE_CHART`

### Migrations / DB
- none

### Scope: Small–Medium (one PR)

## Resolved (Asaf, 2026-07-11)
- Default view: **roto points**, rank (bump) toggle — as planned.
- **Own page** (may merge into Analytics later).
- **Current season only** — no `?season=` param.

## Notes from mockup round (2026-07-11)
- **Mockup:** `standings_race_mockup.html` (repo root) — real 2025-26 data embedded (174 periods × 12 teams computed from `team_daily_snapshot`). Verified: highlight interaction, crosshair tooltip, rank/bump toggle, category selector, dark mode, 390px layout. Final standings cross-checked vs wiki (50 Shades 80.5 #1, Asaf #3 ✓).
- **Overlap found:** `RankingsOverTimeChart.tsx` (Analytics page) already charts per-cat/total rank over time via `useGetRankingsOverTimeQuery` with the same 12 team colors. Race page = evolution of that component's data path, NOT from scratch — reuse its endpoint if it already serves rank series; the new bits are the dedicated page, bump view, highlight-dim interaction, direct right-edge labels, day-7 default.
- Team colors reuse the app's existing `TEAM_COLORS`; palette validated (dataviz six checks) light+dark — CVD warn in the 8–12 band → mitigated by direct labels + highlight interaction (required, keep both).
- Mobile: SVG viewBox scales text too small at 390px — implementation should switch to a taller aspect ratio (or Recharts ResponsiveContainer height) on narrow screens.
- **Season-collision warning stands:** `team_daily_snapshot` has no season column; 2026-27 period 1 upsert will collide with 2025-26 rows. Truncate or add `season` column before next season's scheduler starts writing (separate small task).
