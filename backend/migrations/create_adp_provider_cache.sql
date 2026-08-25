-- Per-provider ADP/rankings source cache.
--
-- Backs a 24h fetch policy for the ESPN/Fantrax/Sleeper source payloads (Sleeper's own docs
-- ask for at most one fetch per day, "save this information on your own servers"). Without
-- this table the app only cached in memory, so Render's free-tier cold starts (idle ~15 min)
-- forced a re-fetch of every provider on every wake regardless of the in-memory TTL.
--
-- One row per provider, replaced whole on refresh -- this is a cache, not a history.

CREATE TABLE IF NOT EXISTS adp_provider_cache (
    provider    TEXT PRIMARY KEY,
    payload     JSONB NOT NULL,
    source      TEXT NOT NULL,
    fetched_at  TIMESTAMPTZ NOT NULL
);

COMMENT ON TABLE adp_provider_cache IS
    'Last successful ADP/rankings fetch per provider (espn, fantrax, sleeper). One row per provider, overwritten on refresh.';
COMMENT ON COLUMN adp_provider_cache.payload IS
    'List of [espn_id, name, adp, positions] rows, as returned by that provider''s parser.';
COMMENT ON COLUMN adp_provider_cache.source IS
    'Human-readable description of where payload came from (shown in AdpResponse.sources).';
COMMENT ON COLUMN adp_provider_cache.fetched_at IS
    'When this payload was fetched. Refresh policy (24h normal, 15min after a failed attempt) is applied in application code, not here.';
