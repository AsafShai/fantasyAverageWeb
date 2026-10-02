# /players response cache + ETag

Branch: `perf/players-response-cache`

## Problem
`PlayerService.get_all_players` caches the windowed DataFrame per preset (5 min), but every request still runs `build_all_players_response` — `iterrows` over ~1100 rows creating ~1100 `Player` Pydantic objects, then FastAPI serialises them. Players, Trade (FA mode) and Projections all request `limit=1200`, so this is the heaviest hot path.

## Change (backend only, no API shape change)
1. `player_service.py`: extend `_windowed_players_cache[time_period]` entry with `players: list[Player]` built once per cache fill (full list, unpaginated). Pagination slices the list, not the frame. Custom ranges stay uncached (unbounded key space).
2. Invalidate together with the frame (same TTL, same entry) — no new invalidation paths.
3. Weak ETag on `GET /players`: hash of `(time_period, page, limit, cache_entry.ts)` → `W/"<sha1-8>"`. If `If-None-Match` matches, return 304 with empty body. Add `Cache-Control: private, max-age=0, must-revalidate` so browsers revalidate but keep the body.
   - RTK Query's `fetchBaseQuery` uses `fetch`; browser handles 304 transparently and serves the cached body, RTK sees 200. No frontend change.
4. Replace `iterrows` with `itertuples(index=False)` in `build_all_players_response` and `build_players_list` only (keep other 27 sites for a later pass — isolate this change per the perf-isolation rule).
5. Optional, measure separately: `ORJSONResponse` as `default_response_class` in `FastAPI(...)`. `orjson` is a new dependency; skip if gain < 20 %.

## Measure before / after
- `scripts/perf_players.sh`: 20 sequential `curl -o /dev/null -w "%{time_total}"` of `/api/players?limit=1200` warm; record median. Expect the build step (~150–300 ms on Render) to drop to slicing cost.

## Tests
- Existing `tests/services/test_player_service.py` must stay green.
- New: second call within TTL returns the same list object (identity), pagination on cached list returns correct `has_more`.
- ETag: matching `If-None-Match` → 304; different → 200 with new tag.

## Risks
- `Player` objects are shared across responses — they are never mutated after build (check `ResponseBuilder` and routes). Mark the list as read-only by convention; do not `.append` to it.
- Memory: ~1100 Pydantic objects × 4 presets ≈ a few MB. Fine on 512 MB.
