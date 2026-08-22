-- Dynamic categories: storage for per-category values that have no column.
--
-- The snapshot/rankings tables carry one column per category for the historical
-- fixed set (FG%, FT%, 3PM, REB, AST, STL, BLK, PTS, plus the raw counting stats
-- on the snapshot). A league scoring anything beyond that -- turnovers being the
-- obvious case -- has nowhere to put the value. These columns hold exactly those
-- extras, and nothing else: a category that already has a column is never
-- mirrored here, so a column and a JSON key can never disagree.
--
-- For a league on the historical 8 the columns stay NULL and cost nothing.
--
-- Nullable ADD COLUMN is metadata-only on PG 11+: no table rewrite, safe to run
-- against a live table. Nothing reads these until the reader PRs land.

ALTER TABLE team_daily_snapshot    ADD COLUMN IF NOT EXISTS stats JSONB;
ALTER TABLE team_rankings_averages ADD COLUMN IF NOT EXISTS ranks JSONB;
ALTER TABLE team_rankings_totals   ADD COLUMN IF NOT EXISTS ranks JSONB;

COMMENT ON COLUMN team_daily_snapshot.stats IS
    'Per-category values with no dedicated column (e.g. {"TO": 120}). NULL when the league scores only the fixed categories.';
COMMENT ON COLUMN team_rankings_averages.ranks IS
    'Per-category ranks with no dedicated column, plus "TOTAL" (the all-category total, which rk_total cannot represent). NULL when the league scores only the fixed categories.';
COMMENT ON COLUMN team_rankings_totals.ranks IS
    'Per-category ranks with no dedicated column, plus "TOTAL" (the all-category total, which rk_total cannot represent). NULL when the league scores only the fixed categories.';

-- Deliberately no GIN index. Every read reaches these rows by the existing
-- (league_id, season_id, team_id, date) btree and then reads the whole document;
-- nothing ever searches inside it. A GIN index here would cost more than the
-- columns it indexes.
