# Trends — expandable per-player game-log chart + ownership filters

Mockup: `trends_sparkline_mockup.html` (click any player name).

## 1. What we're adding

1. **Expandable sub-row per player** (same pattern as `MatchupExpandRow`) — collapsed by default, fetched only on first expand, showing that player's stat game-by-game with the selected recency window shaded.
   - Minutes tab → MPG per game
   - Usage tab → USG% per game, with minutes as background bars
   - Shooting tab → one chart per shooting category, switchable via pills inside the row (3P% / FT% / FG%)
2. **Ownership scope** — drop the backend `fantasy_status == 'FA'` hard filter; add an All / FA-only / Rostered-only toggle plus a fantasy-team dropdown.
3. **Wording fixes** — `pp` → `%`, rename `Dev vs history (pp)`, replace the unreadable `If reverts to baseline` column.

---

## 2. Answers to the open questions

### Is "baseline" career?
No. `trend_service.py:300` builds it from `season_id - 1` and `season_id - 2` only — **the prior two seasons, attempt-weighted, current season excluded**. Not career, not this season. My first mockup said "career baseline"; that was wrong and is fixed.

### Should baseline be season%?
No — that would make the column self-referential (current% vs current% = 0). The whole regression signal is "this season vs a stable prior". But the *chart* should show both: solid line = this season rolling, grey dash = season-to-date average, red dash = the baseline. Then the eye does the comparison.

### Selectable baseline: last season vs prior 2 seasons
Yes, worth it — it's a real trade-off, not a preference:

| Baseline | Pro | Con |
|---|---|---|
| **Prior 2 seasons** (current) | Bigger sample, stable, survives one fluky year | Slow to accept a genuine change — a shooter who rebuilt their form last summer looks "hot" for a whole season |
| **Last season only** | Reacts to real change fast; right for young players still developing | Half the attempts, so noisier; a low-volume shooter's last-season FT% can itself be a fluke |

Implementation: `window_days`-style param — `baseline_seasons: 1 | 2` (default 2). `get_shooting_regression` already builds `prior_seasons` as a list; make the list length the param and cache per `(window_days, baseline_seasons)` instead of per `window_days`. **The volume gates must scale with it**: `baseline_min_att` of 150/150/300 assumes two seasons — halve them for the 1-season mode, or a 60-attempt sample passes and produces garbage deviations.

Frontend: segmented control in the filter bar, next to the window picker. It changes the `Baseline%` column header text, the Δ pill, `If it normalizes`, *and* the red reference line in the chart — all derived from the same number, so one state drives everything. Live in the mockup.

### Making the baseline clearer
Three changes, all in the mockup:
1. **Column header is self-describing**: `Baseline (prior 2 seasons)` / `Baseline (last season)` — the header text changes with the mode instead of a static word "Baseline".
2. **Tooltip on each mode button** spelling out the trade-off above.
3. **Chart reference line is labeled inline**: `baseline (prior 2 seasons) 37.4%` printed on the dashed line itself, so the expand row is readable without a legend lookup.

### `pp` → `%`?
Yes for the UI, with a caveat. `pp` is technically right (difference of two percentages) but nobody reads it. Recommendation:
- Show `+5.6%` in the pill.
- Rename the header so the pill is unambiguous: `Δ USG` → **`Δ USG vs season`**, `Dev vs history (pp)` → **`Δ vs baseline`**.
- Keep the precise meaning in the `title` tooltip ("percentage points, not a relative change").

That way the number is readable and the header carries the meaning. Do **not** silently convert to relative % (a 31.2% → 37.4% move is +6.2pp but +19.9% relative — two different numbers, and the relative one is not the one we want).

### The `If reverts to baseline` column
It's unreadable because it mixes two units and two formats:
- 3P%: `-0.48 3PM/g` (fantasy-relevant makes)
- FT%/FG%: `9.4pp on 5.0/g` (raw deviation + volume, user has to multiply in their head)

Fix: **one unit for all three** — expected change in *makes per game* if the stat snaps back to baseline:

```
made_delta_per_game = -(current_pct - baseline_pct) / 100 * attempts_per_game
```

Rendered as `+0.48 3PM/g`, `-0.21 FTM/g`, `-0.59 FGM/g`, colored green/red. Header: **`If it normalizes`**, tooltip "expected change in makes per game if this player's % returns to their prior-2-season level, at current attempt volume".

For FG% and FT% this is also directionally right for the roto categories (FG%/FT% impact scales with volume, and makes/g is the closest single readable proxy). If we later want exact roto impact, that's a separate "category impact" feature — not this column.

---

## 3. Backend

### 3.1 Remove the FA-only filter (easy)
Three lines in `trend_service.py` (`items = [i for i in items if i.fantasy_status == 'FA']` in each of the three getters). Delete them; the response then carries every qualified player and the frontend filters.

Consequences to check:
- Payload grows. Rough scale: currently gated by `MIN_SEASON_GP=10` + drift/volume gates, so we go from ~FA subset to ~350–450 players for minutes/usage, fewer for regression. That's tens of KB of JSON — fine, no pagination needed.
- The 6h `_TREND_CACHE_TTL` per window stays as-is; no new cache dimension.
- **Do not** add an `ownership` query param — filtering client-side keeps one cached payload per window and makes the toggle instant.

### 3.2 Add `player_id` to the three item models (easy, required)
The expand row needs a stable key to fetch the game log. `player_id` is already in every source dataframe (`current_row['player_id']`, `season_row['player_id']`, the usage `groupby` key) — it just isn't carried into `MinutesMoverItem` / `UsageRoleItem` / `RegressionPlayerGroup`.

Files: `backend/app/models/trend_models.py`, the three `compute_*` functions in `trend_service.py`, and `frontend/src/types/api.ts`.

Name-keyed fetching is not an option — `resolve_join_key` matching already logs misses.

### 3.3 New endpoint: `GET /api/trends/player/{player_id}/gamelog`
Query params: `season` (default current), `window_days` (echo, for the shaded band).

Returns one row per game, ordered by date:
`game_date, matchup, min, fgm, fga, ftm, fta, fg3m, fg3a, usg`
plus a small header block: `player_name, season_gp, window_start, season_mpg, season_usg, season_fg_pct/ft_pct/fg3_pct, baseline_fg_pct/ft_pct/fg3_pct`.

Everything comes from tables we already query:
- minutes + makes/attempts → `fs_player_games` (single-player variant of `aggregate_shooting_by_player`, un-aggregated)
- per-game USG% → the existing `get_usage_components` query with a `player_id` predicate added; reuse `_usg_per_game` unchanged so the chart and the table agree by construction
- baseline % → `aggregate_shooting_by_player(prior_seasons)` filtered to the one player

New `DBService` method: `get_player_game_log(player_id, season, start, end)` — one query joining `fs_player_games` + `fs_team_games` + the team-minutes subquery, restricted to a single player. Cheap: ~40–80 rows.

**Cost**: this is the only genuinely new backend work, and it's ~1 query + 1 route + 1 model. Low risk, no external API calls, no new tables.

---

## 4. Frontend

### 4.1 New component `TrendGameLogRow`
Props: `playerId`, `mode` ('minutes' | 'usage' | 'shooting')`, `windowDays`, and for shooting the qualified stat list from the parent row.

- Fetch via a new RTK Query endpoint `useGetTrendGameLogQuery({ playerId, windowDays }, { skip: !expanded })` — lazy, cached per player, so re-collapsing and re-expanding is free.
- Render with **Recharts** (already a dependency): `ComposedChart` = `Line` (the stat) + `Bar` (attempts / minutes) + `ReferenceLine`s (season, baseline) + `ReferenceArea` (the shaded window).
- Height 170px desktop, 130px mobile.

### 4.2 Expand mechanics in `Trends.tsx`
Each table keeps a `expandedKey: string | null` (single-open accordion — two open charts on mobile is unusable). Player cell gets a caret and `role="button"` + Enter/Space handling, matching the existing `Th` accessibility pattern.

The expand `<tr>` gets `colSpan` = full column count, and its inner div uses `position: sticky; left: 0` — the same fix already used by `.mq-expand-content` in `MatchupDisplay.css`, otherwise the chart scrolls off-screen on mobile when the table is scrolled horizontally.

**Shooting tab — the `rowSpan` grouping stays.** The table already renders one `<tr>` per stat with player/team/owner cells `rowSpan`-merged across the group ([Trends.tsx:331](frontend/src/pages/Trends.tsx:331)). Keep that exactly. What changes:

- **Every stat row in the group is clickable**, and clicking one opens the shared expand row *with that stat selected*. Click FT% → FT% chart. So the user never has to find a pill.
- **One expand row per player**, appended after the group's last stat row, `colSpan` = full column count. Not one per stat — two open charts inside one `rowSpan` group breaks the row merge.
- **Pills inside the expand row** switch stats without collapsing, and only list stats that passed that player's volume gates.
- **The active stat row is highlighted** while open, so the row and the chart are visibly linked.
- Clicking the *same* stat row again collapses; clicking a *different* stat row swaps the chart without collapsing.

Mockup implements exactly this — the earlier `3P% +2 more` single-row version was wrong and has been replaced.

### 4.3 Ownership filter UI
One filter group, applied to all three tabs (they share the `filters` object already):
- Segmented: `All players` / `Free agents only` / `Rostered only` (default: **FA only**, preserving today's behavior so nothing changes for existing users unless they opt in)
- Dropdown of fantasy team names, derived from the distinct `fantasy_status` values present in the loaded payload — no extra API call.
- Both fold into `passesShared()` alongside the existing name/position/minG15 filters.
- Rename the `Status` column header to `Owner` since it now shows real team names most of the time.

---

## 5. Math notes

### Minutes
Straight per-game MPG. Nothing to derive. DNP games are already excluded upstream (`min > 0`), so the line has no false zeros — but that means gaps are invisible. Show the game date on hover so a 10-day absence is readable from the x labels.

### Usage & Role — one chart, not two
**Combined.** "Role" is not a separate quantity — `classify_role_badge` ([trend_service.py:179](backend/app/services/trend_service.py:179)) is a pure function of `delta_mpg` and `delta_usg`. Two separate charts would force the user to eyeball two panels and mentally correlate them, which is the exact judgment the badge already encodes.

One `ComposedChart`:
- **Line, left axis** = USG% per game
- **Bars, right axis** = minutes per game
- Shaded window band across both

That makes the three cases visually distinct at a glance:

| Pattern | Reads as |
|---|---|
| Line and bars both rise in the band | `Role ↑` |
| Bars rise, line flat | `Minutes ↑` |
| Line rises, bars flat | `Usage ↑` — the interesting one; more touches without more court time |

The expand row's stat block carries `Δ USG`, `Δ MPG` and the **Verdict** badge side by side, so the chart and the badge explain each other. Live in the mockup.

Per-game USG% via the existing `_usg_per_game`. **Never** compute it from window totals — the season/window numbers in the table are means of per-game values, so the chart must use the same per-game series or the line's average won't equal the table's number.

Note: the Minutes tab keeps its own single-line MPG chart. The minutes bars in the usage chart are secondary context there, not a duplicate feature.

### Shooting — the one real modeling decision
Raw single-game FT%/3P% is nearly useless: 1-for-2 from the line is 50%, 0-for-1 is 0%. Plotting it produces a sawtooth between 0 and 100 that also destroys the y-axis scale (confirmed visually in the mockup — the first version's dots blew the scale out and flattened the trend line).

Chosen treatment, in order of value:

1. **Line = trailing-5-game attempt-weighted %** — `sum(makes over last 5) / sum(attempts over last 5)`. Attempt-weighted, not a mean of per-game ratios, so a 1-attempt night can't swing it.
2. **Bars = attempts per game** — makes the sample size behind every point visible.
3. **Dots = single-game %**, radius scaled by attempts, clamped to the y-domain and faded when clipped. Optional detail; the eye reads them as scatter around the line.
4. **Two reference lines** — season-to-date % (grey dash) and prior-2yr baseline % (red dash). The gap between them *is* the `Δ vs baseline` number from the table, made visual.

Window shading uses `game_date >= anchor_date - window_days`, identical to the table's window, so "the shaded part is higher than the dashed line" always agrees with the Δ pill.

Rolling window of 5 is a starting value; for FT% specifically 10 may read better (fewer attempts/game). Worth a look once real data is on screen — trivially tunable, one constant.

---

## 6. Effort / risk

| Item | Effort | Risk |
|---|---|---|
| Drop FA-only filter | trivial | none — payload grows modestly |
| Ownership toggle + team dropdown | small | none, pure client-side |
| `pp` → `%`, header renames | trivial | none |
| `If it normalizes` column rewrite | trivial | none, one formula |
| `player_id` on the three models | small | must thread through models + TS types |
| Selectable baseline (1 vs 2 seasons) | small | **must halve `baseline_min_att` in 1-season mode** or the gates let noise through; cache key becomes a pair |
| `/gamelog` endpoint + DB method | medium | one new SQL query; usage join is the fiddly part but is copy-adaptable from `get_usage_components` |
| Minutes / usage expand chart | medium | Recharts inside a `<td colSpan>` needs the sticky-left fix |
| Shooting expand chart + stat pills | medium-large | rolling-window math + interaction with the existing `rowSpan` grouping |
| Mobile layout | small | pattern already proven by `MatchupExpandRow` |

**Less viable / explicitly out of scope:**
- Per-game **z-score** or category-impact charts — needs league-wide per-game distributions, a much bigger lift.
- Opponent-adjusted usage/minutes — would need the matchup service joined per game.
- Prefetch-on-hover — pointless on mobile, adds request volume; skip until the lazy fetch actually feels slow.
- Multiple simultaneously-open charts — deliberately not doing this.

---

## 7. Suggested build order

1. Backend: drop FA filter, add `player_id`, update TS types. (ships on its own, visible immediately)
2. Frontend: ownership toggle + team dropdown + wording/column fixes. (ships on its own)
3. Backend: `/gamelog` endpoint + `get_player_game_log`.
4. Frontend: `TrendGameLogRow` for minutes → then usage → then shooting.
5. Mobile pass at 390px on all three tabs.
