# Remove `/injuries/test-notification`

Branch: `chore/remove-test-notification`

## Finding
`POST /api/injuries/test-notification` (`routes/injuries.py:26`) is live on prod. No caller in `frontend/src`, `extension/src`, or `scripts/`. It mutates `injury_store` (flips a real player's status) and broadcasts a fake `status_change` to every SSE subscriber. It was a manual QA hook for the SSE feature.

## Change
- Delete the route and its `InjuryNotification` construction.
- Delete any test referencing it (`grep -rn test-notification backend/tests`).
- If a manual SSE smoke test is still wanted: replace with a pytest that calls `injury_service.broadcast_notifications` directly, or an `ENVIRONMENT=development`-only route. Recommendation: delete.

## Verification
- `uv run pytest -q` green; `curl -X POST /api/injuries/test-notification` → 404 after deploy.
