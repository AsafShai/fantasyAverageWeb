---
name: review-tests
description: This skill should be used when the user asks to "review tests", "audit tests", "check test coverage", or asks what is/isn't tested. Maps tests to services/routes, assesses quality, and reports gaps ranked by risk.
---

# Review Tests

Audit backend test coverage and quality.

## When this applies
- User asks to review or audit tests
- User asks about coverage gaps
- Before opening a PR that touched backend services/routes

## Steps

1. **Map tests to code** — for each file in `backend/app/services/` and `backend/app/routes/`, find the matching test file. List anything untested.
2. **Assess quality** — check each existing test for:
   - Edge cases (empty data, missing fields, ESPN null returns)
   - Error paths (invalid input, DB errors, network failures)
   - Realistic fixtures (not trivial mocks)
   - Assertions on real outcomes (not just "mock was called")
3. **Report** using ✅ / ⚠️ / ❌ per file, ranked by risk (data mutations > reads). For priority areas, load [references/priority-areas.md](references/priority-areas.md).
4. **Run the suite**:
   ```bash
   cd backend && uv run pytest tests/ -v --tb=short
   ```
   Report pass/fail.

## Output shape
```
## Coverage Report

✅ <file> — <what's well tested>
⚠️ <file> — <what's partial, what's missing>
❌ <file> — <suggested test cases>

### Suite results: X passed, Y failed
```
