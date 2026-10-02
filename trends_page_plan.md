# Trends Page — Design (ideas 3 + 4 + 6 merged)

One page, three sections: **Minutes Movers**, **Usage & Role Changes**, **Shooting Regression**.
Goal: answer "whose situation just changed?" (waiver/trade timing) with data ESPN never shows.
Status: design approved-pending. No code yet. 2026-07-11, updated 2026-07-18 after mockup review (`trends_page_mockup.html`).

## Page layout

Tabs (mobile-friendly) in this order:
1. **Minutes** — MPG risers/fallers
2. **Usage & Role** — usage% shifts combined with minutes
3. **Shooting Regression** — shooting % vs own history, buy-low/sell-high (renamed from "Regression Radar" 2026-07-18 — same statistical meaning, "regression" read as negative-only in casual use)

Each tab = one sortable table + shared control row, all columns sortable by click. Shared controls: player name search, position, fantasy status (FA-only toggle), **min games played in the trailing 15 days** (not season-total GP — a season-long GP threshold doesn't catch a currently-injured/DNP'd player; recency threshold does). Default ≥3 games/15d, options ≥1/≥3/≥5. Games-in-window count itself is shown as a `G(15d)` column, not just filtered on. Every row shows fantasy ownership (FA or owning team name) — the actionable bit.

**Asaf 2026-07-11:** consider defaulting the page (or at least prominently offering) to **league-FA-only** — players not rostered by any fantasy team in OUR league. That's the waiver use case; rostered players' trends matter less. Decide default at build time.

## Section 1 — Minutes Movers (idea 6)

**Source:** `fs_player_games` (Neon) only. Zero external calls.

**Calc:**
- `window_mpg` = avg MIN over player's **last 5 games**
- `season_mpg` = avg MIN over all games this season
- `delta = window_mpg − season_mpg`; risers sorted desc, fallers asc
- Eligibility: ≥2 games in window AND ≥10 season games (else noise); low-sample badge when window has 2 games
- Games-based window (not days) — avoids uneven-schedule distortion

**Columns:** player | team | pos | season MPG | L5 MPG | Δ (color-coded) | GP | fantasy status
Mobile: hide pos + GP (`hidden sm:table-cell`), sticky player column.

**v2 (not now):** "currently starting" badge via `leaguedashplayerstats(starter_bench_nullable='Starters', last_n_games=5)`; per-player MIN sparkline (data already in fs).

## Section 2 — Usage & Role Changes (idea 4)

**Sources (updated 2026-07-18, post-ESPN-migration):** nba_api removed from the codebase entirely (`feat/espn-migration`) — the original plan (`leaguedashplayerstats(measure_type='Advanced')` free USG_PCT) no longer applies. USG% now computed in-house from existing tables, no external calls, no schema change:
- `fs_player_games`: `fga`, `fta`, `tov`, `min` per player per game ✅ present
- `fs_team_games`: `fga`, `fta`, `tov` per team per game ✅ present (no team `min` column — team minutes derived as `SUM(fs_player_games.min)` for that `team_id`+`game_id`)
- Formula: `usg = 100 × (FGA + 0.44×FTA + TOV) × (TeamMIN/5) / (MIN × (TeamFGA + 0.44×TeamFTA + TeamTOV))`, computed per game then averaged over season / last-5 window
- More backend work than the original plan assumed (build+test the formula and join instead of one API field), but not blocked. Minutes delta joined from Section 1 calc.

**Calc:**
- `Δusg = usg_last5 − usg_season` (percentage points)
- Role classification badges:
  - **Role ↑**: ΔMPG ≥ +4 AND Δusg ≥ +2.0pp
  - **Minutes ↑**: ΔMPG ≥ +4 only
  - **Usage ↑**: Δusg ≥ +3.0pp only (same shots, fewer minutes → efficiency-of-opportunity)
  - Mirrored ↓ badges. Thresholds = tunable constants in service.

**Columns:** player | team | season USG% | L5 USG% | Δusg | ΔMPG | role badge | fantasy status

**v2:** TOUCHES / TIME_OF_POSS confirmation signal — no longer available (was nba_api tracking data, source removed). Dropped.

## Section 3 — Shooting Regression (idea 3, renamed from "Regression Radar" 2026-07-18)

**Source:** `fs_player_games` only — current season vs **prior-2-season attempt-weighted baseline** (both in DB; verified 3 seasons). No career API call needed. Rookies/no-baseline → excluded from that stat's list.

**Calc per stat (3P%, FT%, FG%):**
- `baseline_pct` = Σmakes / Σattempts over 2 prior seasons
- `current_pct` = season-to-date
- `dev = current − baseline` (pp) — negative = buy-low (cold vs own history), positive = sell-high (hot vs own history)
- `drift_score = attempts/g × |dev| / 100` (makes/g-equivalent) — volume-weighted swing, used as **the** threshold/sort metric (see below)
- Volume gates (tunable, eligibility only — separate from drift_score): 3P% — current ≥40 3PA, baseline ≥150 3PA; FT% — ≥40 / ≥150 FTA; FG% — ≥100 / ≥300 FGA

**Threshold — 2026-07-18 decision: `drift_score`, not flat pp.** Original plan used a flat `|dev| ≥ 3.5pp` cutoff. Rejected in mockup review: a huge pp swing on very few attempts (e.g. a -14pp FT% dev at only 2 FTA/g) isn't fantasy-relevant, while a modest pp swing on heavy volume (e.g. -3.2pp FG% dev at 14 FGA/g) is. `drift_score` weights attempts in, so it naturally scales — a player must generate real roto-category impact to surface, not just an unusual personal percentage. Threshold value **`drift_score ≥ 0.35`** is provisional (picked to produce a sane split on mock data) — needs calibration against real `fs_player_games` distributions once the service is live. No separate "show cold+hot only / show all" toggle — the threshold *is* the filter, always on.

**Grouping — 2026-07-18 decision: grouped by player, not flat per-stat rows.** A player can independently cross the drift threshold on more than one stat (e.g. cold in both 3P% and FT%). Render as one row per player with a `rowspan` over player/team/status/`G(15d)` cells, and one sub-row per qualifying stat nested underneath (indented, "↳" prefix) — same parent+detail shape as `MatchupExpandRow`. Sub-rows within a group are ordered by `|dev|` descending (worst-offending stat first). Sort-by-column in this view sorts *player groups* by their most extreme qualifying stat for that column, not individual sub-rows.

**Columns:** player | team | `G(15d)` | stat | current% | baseline% | dev (pp) | attempts/g | expected drift ("if reverts to baseline") | fantasy status

**Expected drift column** (display only, not the threshold): for 3P% → `3PA/g × (baseline − current)/100` = Δ3PM/g if the player's % reverts to baseline; FG%/FT% shown as `|dev|pp on {attempts/g}/g` (no single-scalar conversion — those are roto rate categories, not counting stats).

**v2:** self-streak variant (last 10 games vs own season) for in-season hot/cold; TS% version.

## Data flow & refresh

```
fs_player_games + fs_team_games (Neon, nightly job already exists) ──┐
                                                                  ├─→ TrendService (pandas) ─→ /api/trends/* ─→ Trends.tsx
ESPN kona ownership (existing data_provider) ─────────────────────┘
```

- Minutes + Regression + Usage: all computed from DB per request (no external calls anymore — nba_api removed repo-wide), cached via `cache_manager` TTL ~6h.
- Offseason: fs frozen → banner "season ended <max game_date>", tables still render last state.

## Endpoints

- `GET /api/trends/minutes`
- `GET /api/trends/usage`
- `GET /api/trends/regression`
Split per tab → lazy load, one failing source doesn't kill the page. Each response: `{items: [...], window: {...}, last_updated}`.

## Tasks (file-level)

### Backend
- [ ] `app/services/trend_service.py` (new): three compute methods + threshold constants; fs queries via `db_service` pool; usage cache via `cache_manager`
- [ ] `app/routes/trends.py` (new): three GET routes, thin
- [ ] `app/main.py`: register router `prefix='/api/trends'`
- [ ] `app/models/`: response models (TrendMinutesItem, TrendUsageItem, TrendRegressionItem)
- [ ] tests: service calc tests with synthetic fs rows (pytest)

### Frontend
- [ ] `src/pages/Trends.tsx` (new): 3 tabs, shared filters, sortable tables (reuse PlayerRankings table patterns)
- [ ] `src/types/api.ts`: response types
- [ ] data hooks per existing pattern (React Query / fantasyApi — match Players page)
- [ ] navbar entry (respect `VITE_FF_NAV_REORG` Tools dropdown) behind new flag `VITE_FF_TRENDS`
- [ ] mobile per UI rule: overflow-x-auto, sticky player col, responsive padding

### Migrations / DB
- none (v1 reads existing tables only)

### Scope: Medium (one PR)

## Resolved questions (Asaf, 2026-07-11)
- Windows: **L5 games for both** minutes and usage.
- Flag name `VITE_FF_TRENDS` approved.
- Hustle leading-indicators (idea 5): kept OUT of this page; separate decision later, not needed for v1.
- FA-only view: see comment in Page layout section.

## Resolved questions (Asaf, 2026-07-18, from mockup review — `trends_page_mockup.html`)
- Δ-column visual style: **pill badge** (variant B) — colored background chip with ▲/▼, not plain colored text or bar.
- Shooting Regression threshold: **drift_score (volume-weighted)**, not flat pp — see Section 3.
- Shooting Regression rows: **grouped by player** (parent + indented sub-rows per qualifying stat), not flat per-stat rows — see Section 3.
- Min-games filter is **recency-based** (games in trailing 15 days, default ≥3), not a season-total GP threshold — a player can have a big season GP total and still be currently injured/DNP'd. Season-total GP stays separately in the Minutes tab (feeds the plan's existing ≥10-season-games sample-size gate) — two different numbers, two different purposes, both shown.
- All three tabs get: player name search, sortable column headers (click to toggle asc/desc), and the shared FA/position/G(15d) filter row — not just Shooting Regression.
- Usage & Role badges (Role↑/Minutes↑/Usage↑) stay short labels only — raw ΔUSG/ΔMPG numbers live in their own columns, not crammed into the badge text.
