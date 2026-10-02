# Common Endpoint Issues

Load this when the response looks wrong and the immediate cause isn't obvious.

## ESPN-side
- **Null stats for non-players**: players who didn't play in the period return null for stat fields. Don't coerce to 0 — pass null through and render "—" in the UI.
- **Silently dropped fields**: ESPN occasionally omits fields. Use `.get()` defensively in the transformer, don't assume key presence.
- **Season boundary**: period `0` means "season to date", not "week 0".
- **Schedule format changes**: injury PDFs and schedule endpoints have changed format mid-season before — parsers need tolerance.

## Caching
- **ETag staleness**: `data_provider` caches with ETag. After DB updates, responses can lag. Clear the cache or bypass with a fresh fetch to confirm.
- **In-memory vs DB for injuries**: `injury_store` (in-memory, PDF-only) ≠ `player_injury_status` (Neon, persistent). Depth chart reads the DB; the injury page reads memory. Don't cross the streams.

## Pydantic / type mismatches
- Decimals from ESPN (e.g. percentages) can arrive as strings or ints unexpectedly — coerce explicitly.
- Optional fields default to None in Pydantic v2 — check serialization behavior if a field is missing in the response.

## FastAPI routing
- **Trailing-slash redirect**: `/api/players` 307-redirects to `/api/players/`. Some clients don't follow redirects; fetch the canonical URL.
- **Path param types**: `team_id: int` fails with 422 on non-int input. Check the error body.

## DB-related
- Duplicate inserts on snapshot writes are usually the missing ON CONFLICT clause.
- asyncpg connection pooling: if the endpoint hangs, a connection may be leaked. Check `async with` usage.
