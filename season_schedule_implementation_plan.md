# Season Schedule (Fantasy Lens) — Implementation Plan

Status: approved design, ready to build. Design history: `season_schedule_fantasy_mockup.html` through `_v9.html`, `cap_bar_anatomy.html`, `pace_marker_variants.html` (repo root, kept per project convention — see `project_scratch_files.md`).

Framing established during design: with an 822-game slot cap and two ratio categories (FG%/FT%), **filling the cap is not the goal** — it's a ceiling to be aware of, not a target to maximize. Every feature below reports; none prescribes lineup or add/drop decisions.

---

## 0. Shared foundation — schedule service

Everything downstream (tabs ②③④) depends on one new piece: the forward NBA schedule, which does not exist in the codebase today (only past games, via `fs_team_games`).

**New: `backend/app/services/schedule_service.py`**

- Fetches the season's schedule via 7 calls to `espn_client.scoreboard_async(client, yyyymm)` — one per month from `games.season_months()`, already used by the nightly bulk pull.
- All 7 fired together under one `asyncio.gather` — no ordering dependency between months, and the sync `client.scoreboard` (with its `SLEEP_BETWEEN_CALLS` pacing meant for hundreds of sequential nightly-ingest calls) is the wrong tool here; it would serialize needlessly and block the event loop.
- Filters to `is_countable()` events (drops preseason, All-Star, Cup final; keeps Cup group games — confirmed with the user these count normally).
- Derives and caches in-process (same `cache_manager` pattern as `data_provider`, 24h TTL, with a manual bump path if a postponement is reported):
  - per NBA team: full game list (date, opponent, home/away)
  - per date: league-wide game count (slate size)
  - per team: back-to-back count, average rest days, high-volume game count (≥10 games league-wide that night)
- 24h TTL, not longer: two things move during a live season — postponements, and the ~2 Cup-knockout games per team that get slotted in around mid-December (teams show 80 games until then, not 82 — confirmed live against the endpoint, unrelated to `is_countable`, which already handles the Cup final exclusion correctly).
- No new Postgres table. This is a cache, not a dataset — rebuilds in one round-trip (7 parallel requests) if the process restarts.

**New: `GET /api/nba/schedule`** (or folded into existing `nba_teams.py` router) — returns the season grid data for tab ③, and per-team schedule for tab ④. No team-scoping needed on this endpoint; roster overlay (tab ②) reads current roster from the existing `kona_player_info` path (5-min cache) client-side/server-side as appropriate, keeping the two caches independent so an add/drop shows up without touching the schedule cache.

**Testing:** `backend/tests/services/` — mock `scoreboard_async` responses, assert: parallel dispatch (all 7 calls fire without awaiting each other), `is_countable` filtering matches existing nightly-ingest behavior, 24h cache TTL, cache survives one call and serves the second from memory.

---

## 1. Cap bar — TeamDetail, replaces `SlotUsageTable`

**Design reference:** `season_schedule_fantasy_v9.html` tab ①, `cap_bar_anatomy.html`.

Rewrite `frontend/src/components/SlotUsageTable.tsx` (or a new `SlotCapBar.tsx` that replaces it in `TeamDetail.tsx`).

**Data:** unchanged. Same three values `slotProjection.ts::projectSlot()` already returns (`used`, `maxGamesTotal`, `estimatedRounded`), same tone thresholds via `estimatedTone()`. No backend change — this is a frontend-only rewrite of an existing component's rendering, reusing `SLOT_CAPS`, `SLOT_NAMES`, `slotCeiling()` from `slotProjection.ts` as-is.

**Per-slot bar, four segments (left to right), computed from existing values:**

| Segment | Range | Color |
|---|---|---|
| Played | `0 → used` | strong blue |
| On track to add | `used → est` | light blue |
| Still possible | `est → max` | neutral grey (deliberately not blue — unearned headroom) |
| Gone | `max → cap` | pink/red, only rendered when `max < cap` |

- Track has a 1px inset outline (the cap, drawn as a boundary, not a line) — `cap {n}` printed at track's end, fixed-width label column so tracks align across rows regardless of `cap` digit count (82 vs 248).
- **One marker only**: NBA pace, 2px solid line + 7px knob, halo in card background color, positioned once per row at `pace = NBA_PACE * SLOT_MULTIPLICITY[slot]`. Labelled once above the whole bar group (not per-row) since it lands at the same position on all seven 82-cap slots; UTIL gets a `× 3` note both in the header label and its own tooltip.
- Chips below each bar print `played / est / max reachable / gone (if >0) / vs pace (Δ)` — same info as hover, always visible, so nothing is hover-only on touch devices.
- Hover on desktop: each of the four segments gets its own tooltip. Segment tooltips are short labels (`Played 52 of 82`, `On track to add 10 → est 62`, `Still possible +12 → max reachable 74`) since the chips already carry these numbers — **except Gone**, which keeps a full explanatory sentence (`Gone — 8. Only 22 game days remain, so 82 can no longer be reached.`) because it's the only segment whose cause isn't stated anywhere else on screen. Pace tooltip: `NBA pace 68.4 · behind by 16.4.` (UTIL: `68.4 × 3 = 205.2 · ahead by 4.8.`).
- **Known CSS gotcha to carry over:** the hover layer must not itself be a stacking context (no `z-index` on the `.hovers` wrapper) — that trapped tooltips below the pace marker in an earlier iteration regardless of the tooltip's own z-index. Keep hover targets and the pace marker as siblings, lift the active one via `:hover`/`:focus`.
- First-row tooltips flip downward (no headroom above the topmost row).

**Cut features, with reasoning to preserve for future reference:**
- **Cap efficiency (per-player games-used)** — would need ESPN `mRoster&scoringPeriodId=N`, a ~156-call backfill, a new table, a nightly job — all to produce a number that changes no forward decision. Not probed, not built.
- **The old `Rate` row** ("used vs NBA pace" printed per-cell) — superseded by the pace marker; duplicating it as a fifth number per slot was rejected as redundant.

**Testing:** component test — 4-segment render with/without a `gone` segment, tooltip content matches spec above, chip values match `projectSlot()` output, UTIL pace shows the product form.

---

## 2. Roster coverage — TeamDetail, below the cap bars

**Design reference:** `v9.html` tab ②.

**New component**, reads: current roster (`proTeamId` per player, from existing `kona_player_info`/`raw_all_players_to_df` path) × schedule service's per-team game dates.

- One bar per day (14 or 28-day horizon toggle): count of rostered players whose NBA team plays that date. **No core/depth split** — rejected during design because "top 8" is the user's nightly judgment call, not a derivable roster property; nothing in ESPN's data ranks a user's own players.
- Day label tinted on **high-volume days** (≥10 games league-wide, inclusive) — graded intensity, not binary, same blue ramp as tab ③'s month cells (one color family across the whole feature; the earlier yellow-for-off-nights treatment was dropped). Threshold and treatment must stay pixel-identical to tabs ③ and ④.
- **Removed:** the free-agent preview. An alphabetical first-12 list with a `+N more` toggle was a filter, not a ranking or recommendation, so it did not provide enough decision value to justify the space.
- **Cut:** the slot-deficit table (duplicated tab ①'s bars with no new information), start/bench suggestions by z-score (explicitly rejected by the user), and any fabricated "roto points" style scoring.
- **Fetching note for this tab specifically:** switching the 14/28-day horizon or the fantasy-team selector triggers **zero new network calls** — the full season is already cached from the schedule service; horizon and team changes just re-slice the cached game list and re-filter by roster. Worth stating in the UI or at least the component's doc comment, since it's a genuine perf property worth not regressing.

**Testing:** given a fixed roster + schedule fixture, assert per-day counts match; assert horizon toggle doesn't refetch (mock the service call count).

---

## 3. Season grid — new standalone page `/schedule`

**Design reference:** `v9.html` tab ③.

**New page:** `frontend/src/pages/Schedule.tsx`, route `schedule` under the NBA nav group in `App.tsx`, alongside `nba-teams`.

League-wide, **no team picker** — deliberately cut the my-team overlay and its Collision % metric (see rationale below), which means this page needs no fantasy-team selection state at all and works identically in October before any roster context exists.

- Table: 30 NBA teams × 7 months (game counts), heat-shaded on the same blue ramp as everywhere else.
- Extra columns: Total, B2B, High-volume games (≥10 league-wide, same threshold as tab ②/④), Avg rest. Each carries an `InfoTip` (existing `frontend/src/components/InfoTip.tsx` + `metricGlossary.ts` pattern — add a `scheduleGlossary` section or extend the existing glossary file) since several of these aren't self-evident.
- Month columns use month names, not numbers, no year suffix (single season in view).
- High-volume flag chosen over its inverse (low-volume) after checking both on the real 2026-27 schedule: low-volume (<10) hits 78% of days and separates teams only 49–61 of 80 games; high-volume (≥10) hits 22% of days and separates teams 19–31 of 80 — a real spread, sparser flag.

**Cut: my-team overlay / Collision %.** Documented reasoning to prevent relitigating: Collision (share of an NBA team's games landing on nights the user's roster is already at 9+ active players) only has decision force if the user is maximizing games against the cap and choosing between near-equal players — neither holds, since cap-filling isn't the goal and no one takes a worse player for schedule shape. It was also a season-long ratio that can't be meaningfully computed per-month, which is how it was originally (wrongly) presented. Once cut, "My players" (a plain roster count) had no reason to justify a mode switch on its own, so the whole overlay — team selector, mode toggle, both extra columns — was removed from this page.

**Testing:** table renders with real schedule-service data shape; heat-scale bucketing at known min/max; InfoTip content present for every non-obvious column.

---

## 4. Team schedule — stacked section inside existing `NbaTeams.tsx`

**Design reference:** `v9.html` tab ④.

Not a new page. `frontend/src/pages/NbaTeams.tsx` already owns `selectedTeamId` (synced to `?team=` search param) and renders `DepthChartView` beneath it. Render the new schedule section directly below the depth chart, sharing the one team selector and URL param rather than duplicating it. Both sections stay visible so the page represents the complete NBA-team workspace without requiring a tab switch.

- **All of the team's games shown** — user confirmed this explicitly, not a truncated list. Scrolls **inside the table** (fixed `max-height`, sticky header) rather than the whole page — a v2 draft silently showed only the first 16 rows and hid the rest, which is exactly the kind of shortcut that's fine in a mockup and wrong in the product.
- Month separator rows so scrolling stays oriented across an 80-row table.
- Columns: date, opponent (home/away), rest days (0 = back-to-back, flagged), slate size (tinted at the same ≥10 high-volume threshold as tabs ②③).
- KPI row above the table: total games (with the 80-vs-82 note below), B2B count, high-volume game count, avg rest.
- **Games shown: 80, not 82, at season start** — confirmed live against the ESPN endpoint. Every team has exactly 80 published games; 2 slots per team are held open for the Cup knockout round and filled in mid-December. This must be stated in the UI (a callout, not a silent number) or it reads as a bug. Cup *group* games are already regular season and counted; only the Cup final is excluded, unrelated to this gap.
- Opponent defensive rank: slots in from `NbaMatchupService` once `fs_team_games` has current-season results; correctly blank (not a fake placeholder) before the season has games logged.

**Testing:** full 80-row render with month separators present; internal scroll container doesn't affect page scroll; 80-vs-82 callout renders when applicable (i.e., before the Cup fill-in date, which will need a config value or a simple "not yet 82" check against the schedule-service data itself — no hardcoded date).

---

## Sequencing

1. **Schedule service** (0) — everything else blocks on this. Backend-only, no UI change yet; write it, cache-test it, confirm the 7-call parallel fetch and 24h TTL behave under a mocked ESPN client before building on top of it.
2. **Cap bar rewrite** (1) — no backend dependency at all (uses existing `slot_games_estimator`/`team_slot_pace`), can ship independently and immediately once schedule service work is out of the way conceptually (it isn't blocked by it, just sequenced after for review bandwidth).
3. **Coverage** (2) — depends on (0) for schedule dates, plus existing roster fetch.
4. **Season grid** (3) — depends on (0) only; standalone page, no roster coupling, easiest to review in isolation.
5. **Team schedule tab** (4) — depends on (0); smallest frontend footprint since it slots into an existing page.

## Feature flag

New page (3) and new tab (4) should sit behind a flag consistent with the project's existing pattern in `frontend/src/config/featureFlags.ts` (e.g. `VITE_FF_SCHEDULE`) — cap bar (1) and coverage (2) are replacements/additions to an existing always-on page (`TeamDetail`) and don't need gating, but the two new surfaces do, per the project's convention of shipping new pages behind a flag and confirming Render env before assuming visibility.

## Mobile

Per project rule: every surface here was verified at 375px during design (`resize_window` checks logged against each mockup version) — sticky first columns on wide tables, internal `overflow-x`/`overflow-y` scroll containers rather than page-level scroll, chip fallback for the cap bar's hover content, responsive text sizing already baked into the mockups' CSS to carry forward as Tailwind classes during the real build.
