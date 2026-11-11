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
- **Shell** `shell/`: logo header (search, dark mode, ⚙ settings, ☰), bottom tab bar,
  ☰ menu sheet with Select my team and the same groups as desktop
  (`components/navConfig.ts` is shared by both), site footer. The menu and the search
  overlay are history entries: back closes them; a menu/search pick replaces that entry,
  so back from the new page returns to the page they were opened on.
- **Tab bar** `shell/tabs.ts`, `tabPrefs.ts`, `useTabContext.ts`: the bar is the user's
  own, 3 to 5 tabs, chosen in Settings and saved in this browser (`fw:mobile.tabBar`;
  default Home · Standings · Teams · Player Ranks · Trade). `tabs.ts` is the catalog:
  pages, and shortcuts that are not a fixed page: **My Team** (`/team/<myTeamId>`, a dot
  and a trip to Settings until a team is chosen), **Recent** (the last two pages opened from outside the bar; the ☰ menu before there
  are any) and **Search**. To add a tab, add it to the catalog; a shortcut with `to()`
  and `match()` needs nothing else. Unknown ids in storage are dropped, so a retired
  page never breaks the bar.
- **Settings** `settings/` + `/settings` (phone with the flag only; elsewhere it goes
  home): my team, the tab bar editor (presets, reorder, add, remove, labels on/off, reset).
  The bar under the page is the live preview, so there is no Save.
- **Player sheet** `player/`: on a phone every `PlayerNameLink` (and a player
  search result) opens the sheet over the current page as `?player=<ESPN id>`
  instead of going to `/player/:id`. Back closes it; a shared link or reload
  opens it directly. Shows team · positions · slot · GP, the fantasy owner, the
  per-game line (Players list) for the shared `PeriodChips` (incl. Custom range),
  and Full profile / Trade Analyzer, which replace the sheet's history entry.
  No projection in the sheet (it stays on the profile).
- **Filters pattern** `ui/Filters.tsx`: `FilterSearchRow` (search + "Filters (n)"),
  `ActiveFilterChips` (× clears one; "All …" defaults when none), `PositionFilter` (multi-select), `FiltersSheet`
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
- **Trends, Projections, Boom or Bust** (step 5): `trends/MobileTrends` (tab chips, Filters sheet,
  window/scope segmented controls, pinned-player tables, tap a player: chart opens in a row under it, with sheet + profile links;
  shared sort/filter helpers in `utils/trendsShared.ts`), `projections/MobileProjections` (one card per
  player; row logic in `hooks/useAdjustableProjection.ts`), and Boom or Bust, whose phone layout lives in
  `pages/BoomOrBust.tsx` (`mobile/bob/bob.css`).
- **NBA pages** `nba/` (step 5): NBA Teams, Box Scores, Season Schedule and Injuries render
  `MobileNbaTeams` / `MobileBoxScores` / `MobileSchedule` / `MobileInjuries` on a phone. State and
  URL stay in `src/pages/*`; shared logic moved to hooks (`useNbaDepthChart`, `useSlateCalendar`,
  `components/injuries/injuryFormat`). A list picked in a `SelectSheet` that also writes the URL should
  apply it after the sheet closes (see `MobileNbaTeams`). Styles in `nba/nba.css`.
- **Minigames** `minigames/` (step 5): the list and the four games render `MobileMinigames` / `MinigamePageMobile` on a phone; each game keeps its logic and hands the page its board, streak tiles and run-over text. The Who Am I? map is a bottom sheet in browser history. Styles in `minigames/minigames.css`.
- **Preview**: `npm run dev` → `/mobile-kit.html` (dev only, not in the build).
- **League pages** (step 5): Activity (`activity/`; trade views reuse the desktop
  components), Draft Report + FA Report (`draft/`). Styles in each folder's css.
- **League Analytics + Estimator** `pages/analytics/` (step 5): phone tabs in `?tab=heat|race|shots`
  and `?tab=prob|rank|proj`. StandingsRace, ShootingStatsSection and Estimator's sections keep
  their state and render phone controls/tables themselves. Styles in `analytics.css`.
