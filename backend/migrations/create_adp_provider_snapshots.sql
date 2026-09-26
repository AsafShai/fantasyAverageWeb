-- Day-by-day history of each ADP/rankings provider's payload, for the Movers page.
--
-- adp_provider_cache holds only the latest payload per provider and is overwritten (and
-- deleted by a manual refresh), so nothing there can answer "who moved since Tuesday".
-- This table keeps one row per provider per UTC day on which that provider's data
-- actually changed: a new row is written only when the ADP or rankings content differs
-- from the latest stored row, so frozen in-season ADP and rarely-updated rankings cost
-- nothing. "The state on date D" is the latest row with snapshot_date <= D.
--
-- The app also runs this statement itself on first use (adp_snapshots.py), so applying
-- it by hand is optional.

CREATE TABLE IF NOT EXISTS adp_provider_snapshots (
    provider       TEXT NOT NULL,
    snapshot_date  DATE NOT NULL,
    payload        JSONB NOT NULL,
    row_version    INTEGER NOT NULL,
    adp_hash       TEXT NOT NULL,
    ranking_hash   TEXT NOT NULL,
    fetched_at     TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (provider, snapshot_date)
);

COMMENT ON TABLE adp_provider_snapshots IS
    'ADP/rankings payload per provider per UTC day, written only when the content changed. Never deleted by /adp/refresh.';
COMMENT ON COLUMN adp_provider_snapshots.payload IS
    'Same row shape as adp_provider_cache.payload at row_version.';
COMMENT ON COLUMN adp_provider_snapshots.adp_hash IS
    'Hash of the ADP values alone, so an ADP-only change is distinguishable from a rankings update.';
COMMENT ON COLUMN adp_provider_snapshots.ranking_hash IS
    'Hash of the published rankings alone. Rows where this differs from the previous row are rankings update events.';
