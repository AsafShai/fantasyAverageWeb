# Route-level error boundary

Branch: `fix/error-boundary`

## Problem
No `ErrorBoundary` exists in `frontend/src`. A render-time exception in any page (an unexpected null from the API, a bad date) unmounts the whole React tree: blank white page, no nav, no way back without reload. Pages are lazy-loaded; a failed chunk load (deploy while a user has an old tab open) throws the same way.

## Change
- `components/ErrorBoundary.tsx`: class component (React still requires class for `componentDidCatch`). Props: `fallback` render function receiving `{ error, reset }`. Resets on route change via a `key={location.pathname}` on the wrapper.
- Fallback UI: small card inside the Layout: "This page hit an error." + error message (dev only) + two buttons: "Try again" (reset) and "Reload" (`location.reload()` — also fixes stale-chunk cases). Same styling tokens as `ErrorMessage.tsx`.
- Wire in `App.tsx`: wrap `<Suspense>` inside `<Route element={<Layout/>}>` so the navbar survives. Optionally a second boundary around `Layout` for nav crashes.
- Chunk-load failures: catch `error.name === 'ChunkLoadError'` or message matching `/Failed to fetch dynamically imported module/` → auto `location.reload()` once (guard with `sessionStorage` flag to avoid loops).
- Log to `console.error` only (no Sentry — WhatsApp group is the bug channel).

## Tests
- `ErrorBoundary.test.tsx`: child throws → fallback rendered, nav still present; reset re-renders child; chunk error triggers reload once.

## Verification
- Temporarily throw in a page component in dev → fallback with nav intact; navigate away → page recovers.
