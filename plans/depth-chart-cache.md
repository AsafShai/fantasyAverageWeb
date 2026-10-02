# Depth-chart fetch cache (2 h)

Branch: `perf/depth-chart-cache`

## Problem
`DepthChartService.get_on_depth_chart_names` fetches up to 30 ESPN depth charts in parallel every time `/matchups/today` misses its 5-min response cache, and `routes/nba_teams.py` fetches the same URL inline per page view. ESPN depth charts change on roster moves, not per minute.

## Change
1. New in-process cache in `depth_chart_service.py`: `dict[team_id, (fetched_at_monotonic, raw_json)]`, TTL 2 h (constant `_DEPTH_CHART_TTL_S = 7200`). Singleton pattern like `NbaMatchupService`.
2. `get_on_depth_chart_names` reads through the cache; only misses/expired go to ESPN. Fail-open behaviour unchanged (an error does not poison the cache).
3. Move the HTTP fetch out of `routes/nba_teams.py` into the same service (`get_depth_chart_raw(team_id)`), so the depth-chart page and the matchups slate share one cached payload. Route keeps its parsing/injury join.
4. Share one `httpx.AsyncClient` on the service instead of a client per call.

## Why 2 h, not 6 h
ESPN adds new signings/two-way call-ups intraday; a 2 h window bounds staleness to one refresh before a slate. Roster-move day cost: at most one stale look per team per 2 h.

## Tests
- `tests/services/test_depth_chart_service.py`: two calls within TTL → one HTTP call (mock client); after TTL → refetch; HTTP error → empty set for that team and no cache entry.

## Verification
- Watch backend log while opening Players → Matchups twice within 5 min then after 6 min: second window shows zero depth-chart fetches.
