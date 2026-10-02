# Shareable URL state for filters and periods

Branch: `feat/url-state-filters`

## Goal
Players filters, time period + custom range, Rankings date range, mode/view toggles live in the URL query string so a link pasted in the WhatsApp group opens the same view. Reload keeps state. `NbaTeams.tsx` already does this with `useSearchParams` — extend the pattern.

## Performance guard
- Write to the URL with `setSearchParams(next, { replace: true })` on a debounced value (search text: 250 ms, reuse `useDebounce`), never per keystroke.
- Parse once per navigation with `useMemo` on `searchParams.toString()`; components keep local state as today and only sync in/out — no extra renders on the 1200-row table.
- RTK Query keys are unchanged (same args object), so no extra requests.

## Shared hook
`hooks/useUrlState.ts`: `useUrlState<T>(schema)` where schema maps key → `{ parse, serialize, default }`. Omits defaults from the URL so plain `/players` stays clean.

## Pages and keys
- Players: `q`, `pos` (csv), `status` (csv), `team`, `period`, `from`, `to`, `slate`, `onslate` (1), `avg` (0/1), stat filters as `sf=pts:gt:20,reb:gte:8`.
- Rankings: `from`, `to`, `mode`, `view`, `sort`, `order`.
- TeamDetail: `period`, `from`, `to`, `sort`, `order`.
- Trends: `mode`, `window`, `baseline`.

Persisted display prefs (`showAverages`, `integerMode`) stay in `usePersistedState`; URL wins over localStorage when both present.

## Tests
- `useUrlState.test.ts`: round-trip serialize/parse, defaults omitted, invalid values fall back.
- Players page test: mount with `?pos=C&period=last_7` → filters applied.

## Verification
- Copy URL from a filtered Players view, open in a private window → same view. Check mobile Safari back/forward behaviour (replace, not push, so history doesn't fill with keystrokes).
