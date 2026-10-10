# "My team" personalization — plan (not implemented)

## Goal
A visitor sets their fantasy team once, in one global place. From then on the
whole site **tracks** that team: it is starred and highlighted wherever it (or
one of its players) appears. Filtering the pages down to that team is a
separate, **opt-in** preference. There is no login: the choice lives in this
browser only.

Two ideas, kept apart:
- **Who my team is** (identity): set or cleared in the global menu.
- **What pages do about it** (behavior): highlight is on by default, and
  auto-filtering is off by default.

## Non-goals
- Accounts, auth, or any server-side storage of the choice.
- Hiding other teams by default. Highlighting never hides anything. With
  auto-filter on, "all" is always one click away.
- Draft pages and minigames.

## Global "My team" menu
- It lives in `Layout`'s header on every page. On mobile it moves into the
  hamburger menu.
- No team set: a `☆ Set my team` button.
- Team set: `★ <team name> ▾`, which opens a popover with:
  - a team select
  - `☑ Highlight my team` (default on)
  - `☐ Open pages filtered to my team` (default off)
  - `Clear my team`
- First visit with nothing set: a dismissible one-line prompt on Today,
  "Set your team to have it highlighted across the site". Dismissal is
  persisted in `fw:myTeam.promptDismissed`.
- Gated behind `VITE_FF_MY_TEAM` (`config/featureFlags.ts`, like the other
  `FF_*` flags) so it ships dark first.

## Storage and state (fixes same-tab sync)
`usePersistedState` is **not** used here. It keeps a separate React copy in
each component and reads storage only on mount, so a change in the header
picker would not reach the page underneath it. The browser `storage` event
fires only in *other* tabs, so it can't bridge that gap.

Instead, `frontend/src/hooks/myTeamStore.ts` is a tiny module-level store read
through `useSyncExternalStore`: one copy of the value, read live by every
component, with no new dependency and no Redux slice.

- Key: `fw:myTeam` → `{ teamId: number | null, highlight: boolean, autoFilter: boolean }`.
- Store only the id, never the name. The current name is resolved from
  `useGetTeamsListQuery()` at render time.
- `read()` validates each field, so corrupted or old-format JSON falls back to
  the defaults `{ null, true, false }`.
- `setMyTeamSettings(patch)` replaces the snapshot object, writes storage
  (best-effort, in try/catch) and notifies the listeners. Every reader in the
  same tab updates immediately.
- One app-wide `storage` listener, not one per component, handles other tabs.
  It re-reads when `e.key === 'fw:myTeam'` or `e.key === null` (another tab
  called `localStorage.clear()`).

```ts
let current = read();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function setMyTeamSettings(patch: Partial<MyTeamSettings>) {
  current = { ...current, ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(current)); } catch { /* best-effort */ }
  emit();
}

window.addEventListener('storage', (e) => {
  if (e.key === KEY || e.key === null) { current = read(); emit(); }
});

export const useMyTeamSettings = () =>
  useSyncExternalStore((cb) => (listeners.add(cb), () => listeners.delete(cb)),
                       () => current, () => DEFAULTS);
```

## `useMyTeam()` hook (fixes stale-id clearing)
`frontend/src/hooks/useMyTeam.ts` returns
`{ teamId, highlight, autoFilter, myTeam, isResolved, isMine(id), setTeam, clear }`.

The stale-id rule: clear the saved team **only** when a successful, settled,
non-empty teams list does not contain it. A failed, loading or refetching list,
or an empty one (an ESPN hiccup, the off-season), keeps the saved team.

```ts
const { data: teams, isSuccess, isFetching } = useGetTeamsListQuery();
useEffect(() => {
  if (settings.teamId === null) return;
  if (!isSuccess || isFetching) return;      // failed / loading / refetching → keep
  if (!teams || teams.length === 0) return;  // empty list is suspicious → keep
  if (!teams.some((t) => t.team_id === settings.teamId)) {
    setMyTeamSettings({ teamId: null });     // truly gone (new season / league)
  }
}, [settings.teamId, teams, isSuccess, isFetching]);
```

- `isResolved = isSuccess && !isFetching`. Pages wait for it before applying
  any default, so nothing flashes.
- `isMine(id)` is `settings.highlight && id === settings.teamId`. All highlighting goes
  through it, so turning highlight off works everywhere at once.
- The effect runs in every mounted consumer. That is harmless: the first one
  clears the team, and the rest then see `null` and stop.

## Defaults never override the user: `useMyTeamDefault()`
`frontend/src/hooks/useMyTeamDefault.ts`: a control starts at my team (once
`isResolved`), and follows later changes to my team until the user touches
that control. After that the user's choice wins until they leave the page.

```ts
const [value, setValue] = useState(fallback);
const touched = useRef(false);
useEffect(() => {
  if (touched.current || !isResolved) return;
  setValue(enabled && myTeam ? fromTeamId(myTeam.team_id) : fallback);
}, [enabled, myTeam, isResolved]);
const setByUser = (v) => { touched.current = true; setValue(v); };
```

## Shared UI pieces
- `<MineStar />`: a small ★ marker next to a team or player name.
- A row-highlight class for tables and lists.
- `<ShowingMyTeamChip />`: `Showing: ★ <team> [✕ All]`. It appears whenever a
  page is auto-filtered, so a narrowed view is never mistaken for the whole
  league.
- Player → my-team membership: a server-side `fantasy_team_id` field on
  player-shaped records where it's missing (see the decision below), exposed
  to the client as `isMyPlayer(record)`.

## Per page
Highlight applies whenever a team is set and `highlight` is on. The filter
column applies only when `autoFilter` is on.

| Page | Highlight (default) | Auto-filter (opt-in) |
|---|---|---|
| **Today** (`pages/Today.tsx`) | My `roster_health` row pinned first and highlighted; my rows in `RankMovers` marked by `team_id` (not name, so a rename still matches) | — |
| **Rankings / Teams / Standings Race** | ★ and highlight on my row; my line drawn bold in the race chart | — |
| **Team detail** | "Your team" badge; a "Compare with my team" link on other teams | — |
| **Players / Player Rankings / Trends** | ★ on my roster's players | Players: roster-only toggle on |
| **Projections** (`pages/Projections.tsx:159`) | ★ on my players | `fantasyTeamId` starts as my team via `useMyTeamDefault` |
| **Player profile** | "On your roster" badge | — |
| **Injuries** (`pages/Injuries.tsx`) | My players' rows highlighted | A "My roster only" toggle, on. Empty state: "No injuries on <team> — [Show all]" |
| **Schedule / NBA teams / Analytics** | ★ where my team or my players appear | — |
| **Trade** (`hooks/useTradeState.ts:30`) | — | `teamA` starts as my team in **both** modes, since the page always needs a team; still changeable; reset flow unchanged |
| **Estimator** | — | My team pre-selected in both modes, as on Trade |

None of these pages reads URL parameters today. If one gains them later, the
URL beats the stored team, so shared links show what the sender saw.

## Edge cases
- **No team set:** every page behaves exactly as it does today.
- **Teams list loading or failed:** `isResolved` is false. Pages render their
  current defaults and no highlight, and the saved team is kept.
- **Team renamed:** matching is always by `team_id`, and the name is re-resolved.
- **Highlight off:** nothing is starred. Only Trade and Estimator use the team,
  as a pre-selection.

## Decision needed
Player-level membership (Injuries, Players, Projections stars): injury records
carry only the NBA team and a player name.
- **Recommended:** add `fantasy_team_id` to `/api/injuries` records (and any
  other player list missing it) server-side. It's exact, additive, and avoids
  a 1200-player fetch plus a fragile name join ("Jr.", "III").
- Alternative: a client-side normalized-name join, porting
  `adp_service.normalize_player_name` to TypeScript.

## Tests
- **Store:**
  - Same tab: render the header picker and a page reader together, change the
    picker, and assert the reader updates with no reload. This is the
    regression test for the old design.
  - Other tabs: dispatch `new StorageEvent('storage', { key: 'fw:myTeam' })`,
    and also with `key: null`; the value updates.
  - Corrupted storage: `'{bad json'` and `{"teamId":"7"}` both come back as
    the defaults.
- **Stale cleanup:** a teams list with an error keeps the saved team; an empty
  list keeps it; a list still fetching keeps it; a successful list without
  the id clears it.
- **`useMyTeamDefault`:** it applies my team once resolved; it follows a
  header change before the user touches the control; after the user picks a
  value, a header change doesn't override it.
- **Per page:**
  - no team set: the render equals today's behavior
  - team set: highlight shows
  - highlight off: no stars
  - auto-filter on: the chip shows, and ✕ returns to all
- **Injuries:** the roster-only filter keeps exactly my roster's players, and
  the empty state renders.

## Rollout
1. **PR 1:** `myTeamStore`, `useMyTeam`, the global header menu (behind the
   flag), `<MineStar />` and highlighting on Rankings, Teams and Today.
2. **PR 2:** the server-side `fantasy_team_id` field, then player stars on
   Players, Projections, Injuries and Player profile.
3. **PR 3:** `useMyTeamDefault`, and the Trade and Estimator pre-selections.
4. **PR 4:** the auto-filter preference, `<ShowingMyTeamChip />`, and the
   filtered defaults on Injuries, Projections and Players.
5. **PR 5:** the remaining highlights (Team detail, Standings Race, Schedule,
   NBA teams, Analytics, Trends).

Each PR after PR 1 is independent, except that PR 4 builds on PR 3's hook.

## Open questions
1. Membership join: a server-side `fantasy_team_id` (recommended), or a
   client-side name map?
2. Should Today also get a "my matchup this week" card? That's out of scope,
   since it's new UI rather than tracking.
