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
  season per-game line (Players list), the profile's next-game projection with
  a minutes stepper (POST /projections/predict), and Full profile / Trade
  Analyzer, which replace the sheet's history entry.
- **Preview**: `npm run dev` → `/mobile-kit.html` (dev only, not in the build).
