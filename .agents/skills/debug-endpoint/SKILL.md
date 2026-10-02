---
name: debug-endpoint
description: This skill should be used when the user asks to "test an endpoint", "debug a route", "curl the API", reports a wrong response from an API path, or asks "why does /api/X return ...". Walks through curl → response analysis → data flow trace → fix.
---

# Debug Endpoint

Verify and fix a backend endpoint end-to-end.

## When this applies
- User asks to test or debug a specific API path
- User reports a wrong response (nulls, zeros, missing fields, wrong shape)
- After code changes to a route, to verify behavior

## Steps

1. **Identify the endpoint** — find it in `backend/app/routes/`, read the service it calls.
2. **Test with curl** against the local dev server:
   ```bash
   curl -s "http://localhost:8000/<path>" | python -m json.tool
   ```
   Use realistic params (valid team IDs, scoring periods).
3. **Analyze the response** — shape correct? expected fields present? values reasonable? unexpected nulls?
4. **Trace data flow if wrong** — route → service → `data_provider` → ESPN. For DB-backed endpoints, query Neon via the `postgres` MCP.
5. **Pinpoint and fix** — find the exact line, propose fix, re-test.

## Common issues in this project
For a longer list of known gotchas (ESPN nulls, ETag staleness, Pydantic type mismatches, trailing-slash redirects), load [references/common-issues.md](references/common-issues.md).

## Dev server
If not running: `cd backend && uv run uvicorn app.main:app --reload --port 8000`
