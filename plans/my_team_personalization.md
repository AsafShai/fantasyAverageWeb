# "My team" personalization — plan (not implemented)

## Goal
A visitor picks their fantasy team once. Today, Injuries, Trade and
Projections then open focused on that team. There is no login: the choice
lives in this browser only.

## Non-goals
- Accounts, auth, or any server-side storage of the choice.
- Hiding other teams: every page keeps its current "all teams" view one click
  away. "My team" only changes the **default**.
- Changing any API. Every page already has the data it needs, so this is
  frontend-only.

## Storage
- Reuse `usePersistedState` (`frontend/src/hooks/usePersistedState.ts`). It is
  already localStorage-backed, prefixed `fw:`, and survives private browsing
  and quota errors.
- Key: `fw:myTeam.id` → `number | null` (the fantasy `team_id`).
- Store only the id, never the name. Team names change, and the current name
  is resolved from `useGetTeamsListQuery()` at render time.
- Stale id (the team is gone, e.g. a new season or league): treat it as `null`
  and clear the key the first time the teams list loads without it.

## Shared piece: `useMyTeam()` hook + `MyTeamPicker`
- `frontend/src/hooks/useMyTeam.ts`
  - `useMyTeam(): { myTeamId, myTeam, setMyTeam, clearMyTeam }`, backed by
    `usePersistedState('myTeam.id', null)`. `myTeam` is resolved against
    `useGetTeamsListQuery()` (already cached by RTK Query).
  - All pages read the same key. A change in one tab reaches other tabs
    through a `storage` event listener, so they update without a reload.
- `frontend/src/components/MyTeamPicker.tsx`
  - A compact select in the `Layout` header: "My team: [— none —|team…]".
  - First visit with nothing picked: a dismissible one-line prompt on Today,
    "Pick your team to personalise Today, Injuries, Trade and Projections".
    Dismissal is persisted in `fw:myTeam.promptDismissed`.

## Per page

| Page | Today (current) | With a team picked |
|---|---|---|
| **Today** (`pages/Today.tsx`) | `roster_health` card lists every team; movers list is league-wide | My team's roster-health row pinned first and highlighted; movers where my team is involved are marked. The league-wide view is unchanged below. |
| **Injuries** (`pages/Injuries.tsx`) | Filter by NBA team (`filters.teams` = NBA abbreviations) | A new toggle, **"My roster only"**, on by default when a team is picked. Injury records carry only the NBA team and player name, so filter through a player-name → fantasy `team_id` map from `useGetAllPlayersQuery` (the same pattern Projections uses in `playerTeamMap`). The existing NBA-team filter still works on top. |
| **Trade** (`pages/Trade`, state in `hooks/useTradeState.ts`) | `teamA` starts `null` | `teamA` starts as my team, in both "team" and "free agent" modes, and the user can still change it. Only the initial value changes; the reset flow keeps working as it does now. |
| **Projections** (`pages/Projections.tsx`) | `fantasyTeamId` filter starts `''` (all) | It starts as `String(myTeamId)`. The picker's "All teams" option still clears it. |

URL parameters, where a page has them, beat the stored team, so shared links
show what the sender saw (`usePersistedState`'s `initialOverride` already
does this).

## Edge cases
- **No team picked:** every page behaves exactly as it does today (default `null`).
- **Teams list still loading:** render the pages' current defaults, then
  apply my team once the list resolves. Don't flash an empty filtered state.
- **Name-based join on Injuries:** injury names and ESPN names can differ in
  punctuation or suffixes (Jr., III). Reuse the normalization the backend
  already applies (`adp_service.normalize_player_name`), ported to a small TS
  util, or add `fantasy_team_id` to `/api/injuries` records server-side (a
  small, additive change). **Decision needed**; the recommendation is the
  server-side field, because it's exact and removes the need for a
  1200-player fetch on the Injuries page.
- **Feature flag:** gate the picker behind `VITE_FF_MY_TEAM`, like the other
  `FF_*` flags, so it ships dark first.

## Tests
- `useMyTeam`:
  - persists and reads back
  - a stale id resolves to `null` and clears the key
  - a cross-tab `storage` event updates the value
- One test per page:
  - with no team stored, the rendered default equals today's behavior (pins current behavior)
  - with a team stored, the page defaults to that team
  - the user can still switch to "all"
- Injuries: the "My roster only" filter keeps exactly my roster's players.
  Use a name-normalization fixture with a "Jr." case.

## Rollout
1. PR 1: the `useMyTeam` hook, the picker in the header behind the flag, and Projections. Projections is the simplest page, since it already has a fantasy-team filter.
2. PR 2: Trade (initial `teamA`).
3. PR 3: Today (pin and highlight).
4. PR 4: Injuries. This one depends on the name-join decision above.

Each PR is independent after PR 1 and is small enough to review in one sitting.

## Open questions
1. Injuries join: a server-side `fantasy_team_id` field (recommended), or a client-side name map?
2. Should Today also show a "my matchup this week" card? That's out of this plan's scope, since it's new UI rather than a default.
