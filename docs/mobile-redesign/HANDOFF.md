# Mobile redesign — implementation handoff

**Goal:** redesign the **phone view** of fantasyleagueinfo.onrender.com so it is easier and nicer to use on a phone, **without losing any information the site shows today and without adding new features**. Desktop stays as it is.

Status: design approved (v2, Nov 6 2026). Small UI bugs in the mock are expected to be fixed during implementation.

---

## 1. What to look at

| Source | What it is |
|---|---|
| `docs/mobile-redesign/screens/*.jpg` | Full-height screenshot of every redesigned screen (390 px wide, 2×). **Primary visual reference.** |
| `docs/mobile-redesign/prototype.html` | The clickable v2 prototype. Open it in any browser; add `?start=team`, `?start=players`, `?start=sheet` … to jump to a page. Real data snapshot from Nov 6. |
| `docs/mobile-redesign/PARITY.md` | Feature-parity checklist: every feature of every live page and where it lives in the redesign. **Acceptance checklist for each page PR.** |
| Design canvas (claude.ai) | https://claude.ai/artifact/75c92JPNBakr2nqycYSGMX — pages: **v2 · Redesign (current)**, **v1 · First concept** (for comparison only), **Compare v1 ↔ v2**, plus the audit of today’s production on a phone. |

Screens index: `01-today` · `02-standings-rankings` · `03-standings-cards` · `04-standings-values` · `05-teams` · `06-team-statistics` · `07-team-roster-daily` · `08-team-roster-stats` · `09-team-slots-coverage` · `10-trade` · `11-players` · `12-players-filters` · `13-player-rankings` · `14-player-profile` · `15-player-sheet` · `16-menu` · `17-search` · `18-activity` · `19-draft-report` · `20-fa-report` · `21-analytics-heatmap` · `22-analytics-standings-race` · `23-analytics-shooting` · `24-trends` · `25-projections` · `26-boom-or-bust` · `27-estimator` · `28-nba-teams` · `29-box-scores` · `30-schedule` · `31-injuries` · `32-minigames` · `33-minigame-hangman` · `34-dark-mode`.

---

## 2. Ground rules (decided with the owner — do not re-litigate)

1. **Same information, same features.** Every heading, control, filter, column and visual on the live page must still exist (see `PARITY.md`). Reorganising *within* a page is fine (tabs for long pages, a Filters sheet, cards instead of rows, pinned first column).
2. **No new features or "insights".** Rejected in review: pickup suggestions, "who moves your categories", NEAR YOU, tightest races, trade fit, games-pace advice, title odds on other pages. Don’t add derived advice.
3. **Don’t mix unrelated pages.** Each page shows its own data. Links are fine only where they lead to the full version of the same information (e.g. Today’s Top 5 → Standings).
4. **Keep the visuals.** Bars, charts, colored pills, logos, badges from the live site stay (slot usage bars, roster coverage chart, Standings Race line chart, heatmap colors, schedule grid colors, z-score bars, Trends game-by-game chart, injury status pills, box score logos…).
5. **It is the mobile view of a website, not an app.** Real URLs for every view, the browser back button works (closes sheets first), logo header + site footer stay. The bottom tab bar *is* wanted.
6. **Mobile only.** Changes apply below the `md` breakpoint; desktop layouts unchanged.
7. Roto league (12 teams, 8 categories, per-slot game caps) — not head-to-head.

---

## 3. Global design system

**Look:** light grey page `#F2F4F7`, white cards (radius 16, padding 14), text `#0E1726`, muted `#5B6474`, borders `#E3E6EB`, primary blue `#1D4ED8`/`#2563EB`, brand gradient `#2563EB → #7C3AED` (logo, a few page titles). Fonts: **Inter** for text, **Space Grotesk** for numbers and titles. Tap targets ≥ 40 px.

**Shared components to build first** (reused by most pages):
- **Header:** brand logo "Fantasy League" (links to Today), search, dark-mode toggle, ☰ menu.
- **Bottom tab bar:** Today · Standings · Teams · Players · Trade (height 76, icon in a rounded pill, active = blue). Matches v1’s bar.
- **Menu sheet:** today’s 6 groups and items unchanged (League, Players, Insights, Tools, Minigames, NBA), “Select my team” on top. Dev adds **FA Report** under League.
- **Segmented control**, **chip row** (horizontal scroll), **select button** (opens a bottom-sheet list).
- **Data table:** sticky header, **pinned first column**, sortable headers (▲/▼), my-team row highlight, horizontal scroll for the rest.
- **Pills/badges:** status (Out red, Doubtful orange, Questionable amber, Probable blue, Available green), slot badges (starter green, Bench grey, IR orange), move kind (Added green, Waiver claim lime, Trade blue, Dropped grey), FA mark.
- **Deltas:** small bold ▲ green / ▼ red next to numbers (gray “–” for no change on totals, gray “+n” for GP). **Only in Rankings view** — Standings view shows no colors at all.
- **Bottom sheet** (player sheet, filters, pickers) — must sit under browser chrome and close on browser back.
- **Minutes stepper:** `− 31 min +` and ↺ reset (stepper, not a slider, inside sheets/cards).
- **Footer:** © Asaf Shai + email / GitHub / LinkedIn, as today.

**Player sheet** (opens from any player name anywhere): name, NBA team · positions · slot · GP, fantasy owner badge, season per-game grid (MPG PTS REB AST STL BLK 3PM FG% FT%), next-game projection with the minutes stepper (stats recompute), buttons **Full profile** and **Trade Analyzer**. URL: `?player=<name/id>`; back closes it.

**Filters sheet:** pages with long filter forms (Players, Player Rankings, Trends, Projections) show search + a “Filters (n)” button + active-filter chips; the sheet holds exactly today’s filters.

---

## 4. Page-by-page decisions

- **Today** (`01`): trade-deadline card only in the last 7 days (as today). Top 5 Teams as a dark card near the top with “since yesterday” change + **Full standings**. Rank movers **grouped per team** (“▼6 Khachapuri’s · STL −3 · 3PM −2”) with team/category filters + link to Rankings. Roster health tiles + colored count pills + Injuries link. Latest moves with team abbrev + kind badges + All activity. League averages (+ “per team, season to date”) + link to Standings values. Each card links to its full page.
- **Standings & Rankings** (`02–04`): Layout **Table / Cards** (dev), Show **Standings / Rankings**, Values **Averages / Totals**. Date range collapsible with From/To, Apply, Clear, Quick range 1d/7d/15d/30d (these are date presets, not movers). Show/Hide movers next to it (Rankings view only). Table: `#rank team` pinned with rank change, plain category cells (**no heat colors**), colored deltas in Rankings view only. Explainer text as today.
- **Teams** (`05`): list as today, my team first.
- **Team page** (`06–09`): header card (rank · points · change, category points strip, View on ESPN, Share), then 3 tabs: **Team Statistics** (overall rank, total points, FG/FT made-attempted, games played, shot chart, per-game averages), **Roster**, **Slots & coverage**. Roster modes **Daily (default, dev) / Stats / Schedule**. Daily = day stepper, Moves strip, **one roster table** (starters then bench/IR, slot badges), **no Status column** (🩹 = out, “—” in OPP = no game). Stats = today’s full table (Include checkboxes, matchup expand, period, Per Game/Totals, Integer projections). Slot usage with fill bars and caps; Roster coverage bar chart with legend.
- **Trade** (`10`): Team vs Team / Team vs Free Agents, period, Total/Per Game, Team A ⇄ Team B switch (one side at a time), team rankings bar, player cards, comparison table + **sticky Avg Z summary** at the bottom.
- **Players** (`11–12`): search, Filters sheet, “Showing N players”, Stats/Schedule, Per Game/Totals, period chips, table with name pinned and text columns after the stats.
- **Player Rankings** (`13`): Calc/Display mode, period incl. Last night, **category weight sliders with punt buttons** (as today), legend, table with Z and _z columns.
- **Player profile** (`14`): bio folded; Fantasy Value (overall rank, position ranks, Z-score, ESPN eligibility, green/red z-bars, Full rankings link), Stats Per Game/Totals, Trends tiles → game-by-game chart, projection card, game log with W/L and AVG row.
- **Activity** (`18`): tabs, filters, counts summary, moves grouped by day with time, team abbrev, kind badges; trades as “X got … / Y got …”.
- **Draft Report** (`19`, dev): board with “pick → value · gp” under names, verdict badges (Steal/Solid/Fair/Reach/Bust, INJ/Low GP/DNP), Team Draft Value table, Team Grades with “Not ranked”.
- **FA Report** (`20`, dev): new page exactly as dev.
- **League Analytics** (`21–23`): Heatmap (red/white/green vs league average, rank in brackets), **Standings Race line chart** (Basis Per Game/Season Totals, Show Roto Points/League Rank/Stat Value, Category, team highlight chips, range brush), Shooting Stats.
- **Trends** (`24`): tabs, window, scope, Filters; tap a player → **game-by-game chart** (per-game makes/attempts bars vs season, baseline, league lines).
- **Projections** (`25`): one **card per player** with status dot, injury tag, matchup, **minutes stepper** (stats recompute) and the projected line; sort chips; Reset all minutes.
- **Boom or Bust** (`26`): summary line, Booms and Busts cards each with their threshold slider, highlighted stat pills, player’s NBA/fantasy team.
- **Estimator** (`27`): three sections as tabs; yellow→orange probability heat; ± std dev in projections.
- **NBA Teams** (`28`): **depth chart grid** like today (Position × Starter…5th, injury pills, FA mark, logo + record, Exclude Out/Doubtful/Questionable/Probable + Duplicates) and the team schedule.
- **Box Scores** (`29`): Full box / No spoilers, date nav, game cards with logos + team colors scrolling sideways.
- **Season Schedule** (`30`): NBA Cup info box, games-per-night chart, tonight’s matchups, Who-plays-when grid (blue plays / orange 2nd night of B2B / grey off), month density table.
- **Injuries** (`31`): **cards** (as today on phones) with status pills, Roster tag, Notifications (count), status/team filters, scope All / My players’ teams / My players, Sort by + direction.
- **Minigames** (`32–33`): as today with real descriptions.

---

## 5. Mock vs real (don’t copy these literally)

- Minutes stepper: the mock scales counting stats linearly; the real one must call the projection endpoint (`POST /projections/predict`), like the Projections page/profile slider today.
- Some numbers are placeholders: team-page Schedule-mode dots, Trade comparison values (only labels follow the picked teams), player-profile rank/z values (Donovan Mitchell’s), Draft/FA value ranks computed without the 10-GP minimum.
- Daily roster in the mock uses today’s lineup/matchups/moves; the real view uses dev’s `GET /teams/{id}/roster-day`.
- The address bar in the mock only illustrates URLs + browser back; the real site uses the browser’s own.
- Sliders, date pickers, Share, Explain, ESPN links are drawn, not wired — wire them as today.

---

## 6. How to implement

**Base branch: `dev`** (it already has Daily roster, FA Report, Rankings Cards, Standings Race Stat Value, Draft verdicts — the design includes them).

**Flags**
- Add `FF_MOBILE_REDESIGN` in `frontend/src/config/featureFlags.ts` (build-time `VITE_FF_MOBILE_REDESIGN`, default off).
- Add a **runtime override** (`?ff=mobile` → stored in localStorage, `?ff=off` clears) so the owner can try it in production on his phone while the league still sees the old UI; toggling needs no redeploy.
- Gate only below the `md` breakpoint. Unconverted pages keep their old layout inside the new shell.

**PR sequence** (one PR each, small and reviewable):
1. Foundation: tokens + shared components (table, segmented, chips, pills, sheet, stepper). No visible change.
2. Shell: header, bottom tab bar, menu sheet, footer, URL/back handling for sheets.
3. Player sheet (global).
4. Today → Player profile → Team page → Trade → Standings & Rankings → Players → Player Rankings.
5. Remaining pages: Box Scores, Activity, Schedule, Injuries, Projections, Trends, Estimator, Analytics, Draft/FA Report, NBA Teams, Minigames.
6. Rollout: owner → league; after 1–2 stable weeks delete the old mobile code paths and the flag.

**Reporting per step** (see `PROJECT_SETUP.md`): explain the plan first; show commands and test output verbatim; finish with live 390 px screenshots next to the matching design screenshots and the PARITY checklist for the pages touched.

**Each PR:** matches its screenshot(s); every item in its `PARITY.md` section is present; existing page tests (`frontend/src/pages/__tests__`) still pass + new tests; Playwright screenshot at 390 px; check loading / empty / error / long names / dark mode.

**Also add early:** simple page-view tracking (one event per route change) so usage can be compared before/after (today’s logs can’t tell which preloaded page was viewed).

**Repo pointers:** routes `frontend/src/App.tsx`; nav `frontend/src/components/Layout.tsx`; flags `frontend/src/config/featureFlags.ts`; data `frontend/src/store/api/fantasyApi.ts`; URL state `frontend/src/hooks/useUrlState.ts`; pages `frontend/src/pages/*`; shared pieces `frontend/src/components/*` (TimePeriodSelector, MatchupDisplay, SlotUsageTable, RosterCoverage, RosterDayView on dev).

---

## 7. Open questions for the owner
- First tab label: **Today** (page name) or **Home** (v1)? Currently Today.
- Desktop: keep as is, or a later pass applying the same visual language?
