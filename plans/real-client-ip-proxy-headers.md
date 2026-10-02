# Real client IP behind Render (proxy headers)

Branch: `fix/proxy-headers-real-ip`

## Current state (verified 2026-09-18)
- `main.py`: `Limiter(key_func=get_remote_address, default_limits=["100/minute"])`.
- **`SlowAPIMiddleware` is never added**, so `default_limits` applies to nothing. Only two routes are actually limited, both decorated explicitly:
  - `GET /` → 20/minute
  - `GET /health` → 60/minute
- Every `/api/*` route is **unlimited** today.
- Uvicorn is started via `uvicorn.run(app, host, port)` with defaults: `proxy_headers=True` but `forwarded_allow_ips="127.0.0.1"`. Render's proxy is not loopback, so `X-Forwarded-For` is ignored and `request.client.host` is the proxy IP for every user. Consequences: the two limited routes share one bucket across all users; logs show one IP for everyone.

## Change
1. `backend/app/main.py` `__main__` block: `uvicorn.run(app, host="0.0.0.0", port=settings.port, proxy_headers=True, forwarded_allow_ips="*")`. Render terminates TLS and is the only hop, so trusting `*` is acceptable there; local dev unaffected.
2. Decide on `/api` limiting explicitly (pick one, do not leave implicit):
   - Option A (recommended): keep `/api` unlimited, delete the misleading `default_limits` arg so the code says what it does.
   - Option B: add `app.add_middleware(SlowAPIMiddleware)` and set a generous per-IP default (e.g. 300/minute) — draft night: each Players page load fires ~6 requests, mock draft room polls more. Only pick B with a measured number.
3. Add a one-line access log with the resolved client IP for slow requests (see health-verbose plan) so the fix is observable.

## Tests
- `tests/routes/test_rate_limit.py`: request `/health` 61 times with distinct `X-Forwarded-For` values → no 429; same IP 61 times → 429 on the last.

## Verification
- Deploy to Render, hit `/health` from two devices, confirm logs show two different IPs.
