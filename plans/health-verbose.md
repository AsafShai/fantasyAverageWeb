# Verbose /health + slow-request log

Branch: `feat/health-verbose` · Mockup: section 4 of the upgrade-board artifact (JSON shape below is the contract)

## Goal
`GET /health` stays cheap for the cron pinger. `GET /health?verbose=1` reports what you check by hand after a deploy. Plus a middleware that logs any request slower than 1 s with method, path, ms, client IP.

## Response shape (`verbose=1`)
```json
{
  "status": "healthy",
  "uptime_s": 8040,
  "db": {"ok": true, "ping_ms": 38},
  "espn": {"totals_age_s": 180, "players_age_s": {"0": 290}, "totals_etag": "W/\"3f1\"", "data_date": null},
  "injury": {"last_report": "2026-09-18T10:30-04:00", "players": 41, "sse_clients": 2},
  "nightly": {"last_date": "2026-09-17", "status": "processed", "rows": 412, "store_loaded": true},
  "estimator": {"as_of_date": "2026-09-18"},
  "schedulers": {"injury_next": "...", "nightly_next": "...", "estimator_next": "..."},
  "slow_requests_1h": 3
}
```

## Backend
- `services/health_service.py`: one async function `collect(verbose: bool)`; each sub-collector wrapped in try/except returning `{"ok": false, "error": "..."}` so health never 500s.
  - `db`: `SELECT 1` timed via the existing pool.
  - `espn`: read `CacheManager.totals_cache` / `players_<n>` timestamps (add `fetched_at` to `totals_cache` — today it stores only etag/data; `players_*` already has `timestamp`).
  - `injury`: `injury_service.last_report_time`, `len(injury_store)`, `len(sse_subscribers)`.
  - `nightly`: `DBService.get_model_nightly_run(latest)` → add `get_latest_model_nightly_run()`; `ModelNightlyService()._store is not None`.
  - `estimator`: `EstimatorService()._cache_date`.
  - `schedulers`: each scheduler module exposes its `_compute_next_trigger()` already; call and isoformat.
- `main.py`: `/health` reads `verbose` query param; keep the 60/min limit.
- Middleware `utils/timing_middleware.py`: `@app.middleware("http")`, measures wall time, logs `WARNING slow_request method path ms ip` when > 1000 ms, sets `X-Process-Time` header, increments a ring counter used by `slow_requests_1h`.

## Tests
- `tests/routes/test_health.py`: default response unchanged; verbose with DB mocked down returns `db.ok=false` and HTTP 200.
- Middleware test: fake slow route → header present, log emitted.

## Verification
- `curl -s localhost:8000/health?verbose=1 | jq` locally with DB up; then on Render after deploy.

## Notes
- No auth on verbose: it exposes cache ages and dates only, no secrets. Keep it that way (never include DSN, hostnames).
