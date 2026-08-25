-- Row-shape version for the per-provider ADP/rankings cache.
--
-- Provider rows grew a fifth field (the provider's own published ranking, alongside ADP)
-- when the Rankings view landed. A payload persisted under the old four-field shape would
-- deserialize into the wrong slots, so each row records the shape it was written with and
-- the app discards anything that does not match its current PAYLOAD_VERSION.

ALTER TABLE adp_provider_cache
    ADD COLUMN IF NOT EXISTS row_version INTEGER NOT NULL DEFAULT 1;

COMMENT ON COLUMN adp_provider_cache.row_version IS
    'Shape of the rows in payload. 1 = [espn_id, name, adp, positions]; 2 = + ranking. Mismatched rows are ignored and re-fetched.';
COMMENT ON COLUMN adp_provider_cache.payload IS
    'List of [espn_id, name, adp, positions, ranking] rows, as returned by that provider''s parser. See row_version.';
COMMENT ON TABLE adp_provider_cache IS
    'Last successful ADP/rankings fetch per provider (espn, fantrax, sleeper, yahoo). One row per provider, overwritten on refresh.';
