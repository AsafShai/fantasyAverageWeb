# RTK Query refetch on focus / reconnect

Branch: `fix/rtk-refetch-listeners`

## Problem
`store.ts` never calls `setupListeners(store.dispatch)`, and no endpoint sets `refetchOnFocus`/`refetchOnReconnect`. A phone tab left open overnight shows yesterday's rankings until the user hard-refreshes: RTK's `keepUnusedDataFor` only governs cache eviction when no component subscribes, not staleness of mounted data.

## Change
- `store/store.ts`: `setupListeners(store.dispatch)`.
- `store/api/fantasyApi.ts` `createApi(...)`: `refetchOnFocus: true`, `refetchOnReconnect: true`, `refetchOnMountOrArgChange: 120` (seconds — remount after 2+ min refetches in background while showing cached data).
- Opt out for endpoints where a background refetch would disrupt: `getAdp`/`getAdpIndex` during mock draft (`refetchOnFocus: false` per endpoint), `predictProjection` (mutation, unaffected).

## Behaviour
Refetch is background: `data` stays rendered, only `isFetching` flips. `GlobalLoadingBar` already reacts to pending queries, so the user sees the top bar move.

## Tests
- `store.test.ts`: dispatching `onFocus()` action from `@reduxjs/toolkit/query` triggers refetch of a subscribed mock endpoint.

## Verification
- Open Rankings, switch tab for 3 min, return → network tab shows `/rankings` refetch, table never flashes to a spinner.
