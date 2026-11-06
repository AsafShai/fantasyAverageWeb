# Mobile redesign (phones, below 768px)

Step 1 of the redesign: the flag, tokens and shared components. Nothing here is
rendered by the live pages yet.

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
- **Preview**: `npm run dev` → `/mobile-kit.html` (dev only, not in the build).
