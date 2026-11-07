# Mobile redesign (phones, below 768px)

Step 1 added the flag, tokens and shared components; step 2 the phone shell;
step 3 the player sheet.
With the flag on and a phone-width window, `Layout` renders `shell/MobileShell`
instead of today's nav; pages that are not converted yet render unchanged inside it.

- **Flag** `flag.ts`: `useMobileRedesign()` is true when `VITE_FF_MOBILE_REDESIGN=true`
  or this browser opted in with `?ff=mobile` (`?ff=off` clears it), **and** the
  viewport is below `md`. Desktop never changes.
- **Tokens** `tokens.css`: `--mr-*` CSS variables (light + `.dark`), also exposed to
  Tailwind as `bg-mr-card`, `text-mr-muted`, `font-mr-num`, `rounded-mr-card` …
- **Components** `ui/`: `Card`, `Button`, `Segmented`, `Chip`/`ChipRow`/`ChipSelect`,
  `SelectSheet`, `StatusPill`/`SlotPill`/`MoveKindPill`/`FaMark`, `Delta`,
  `DataTable` (sticky header, pinned first column, sortable, my-team row),
  `BottomSheet` + `useSheetHistory` (browser back closes the sheet first),
  `MinutesStepper`. Wrap redesigned screens in `.mr-root`; call
  `ensureMobileFonts()` once (Inter + Space Grotesk).
- **Shell** `shell/`: logo header (search, dark mode, ☰), bottom tab bar
  (Home · Standings · Teams · Players · Trade, `tabs.ts`), ☰ menu sheet with
  Select my team and the same groups as desktop (`components/navConfig.ts` is
  shared by both), site footer. The menu and the search overlay are history
  entries: back closes them; a menu/search pick replaces that entry, so back
  from the new page returns to the page they were opened on.
- **Player sheet** `player/`: on a phone every `PlayerNameLink` (and a player
  search result) opens the sheet over the current page as `?player=<ESPN id>`
  instead of going to `/player/:id`. Back closes it; a shared link or reload
  opens it directly. Shows team · positions · slot · GP, the fantasy owner, the
  per-game line (Players list) for Season / Last 7 / 15 / 30 / Custom range,
  and Full profile / Trade Analyzer, which replace the sheet's history entry.
  No projection in the sheet (it stays on the profile).
- **Filters pattern** `ui/Filters.tsx`: `FilterSearchRow` (search + "Filters (n)"),
  `ActiveFilterChips` (× clears one; "All …" defaults when none), `FiltersSheet`
  (Reset + Show results) and `FilterGroup`. Pair it with `useSheetHistory('filters')`.
  `ui/PeriodChips.tsx` is TimePeriodSelector as a chip row (Custom opens today's
  date-range picker). `DataTable.renderAfterRow` adds a row under a row (matchup panel).
- **Pages** `pages/<page>/`: a converted page keeps its state, data and URL params in
  `src/pages/<Page>.tsx` and renders the phone layout from here when
  `useMobileRedesign()` is on. Step 4: Players.
- **Player profile** `profile/` (step 4): `/player/:id` on a phone. Header with
  owner badge, Bio folded, time frame chips (Custom opens a From/To sheet),
  Fantasy Value with z-bars, Stats table, Trends tiles + game-by-game chart,
  next-game projection with the minutes stepper, game log with AVG row. Data
  comes from the same hooks as desktop (`hooks/usePlayerProfileData`,
  `hooks/usePlayerTrends`); styles in `profile/profile.css`.
- **Standings & Rankings** `pages/rankings/` (step 4): converted pages keep their state, URL and data in
  `src/pages/*` and hand a phone layout the same props. Standings & Rankings:
  `pages/rankings/RankingsMobile.tsx`.
- **Teams + Team page** `team/` (step 4): `Teams` and `TeamDetail` render
  `MobileTeams` / `MobileTeamDetail` on a phone. TeamDetail keeps all state and
  passes it down; the phone tab is `?tab=stats|roster|slots` (roster modes stay
  `?mode=daily|stats|schedule`). Today's matchup opens in a bottom sheet with the
  minutes stepper (`MatchupExpandPanel minutesStepper`). Styles in `team/team.css`.
- **Preview**: `npm run dev` → `/mobile-kit.html` (dev only, not in the build).
