-- Boom or Bust: scope the fantasy columns to the ESPN season they were read for.
-- ESPN reuses fantasy team ids across seasons (id 4 was CADE in 2026, LA in
-- 2027), so fantasy_team_id means nothing without its season. The abbrev is
-- resolved at read time from the current season's teams, so fantasy_team stops
-- being written (dropped later by drop_surprise_fantasy_team.sql).
--
-- Apply BEFORE deploying the code that writes season_id. season_id stays
-- nullable until that deploy: rows the old code writes in between get NULL,
-- which the new reader shows without fantasy context.
--
-- updated_at: the upsert used to reset created_at on every write; it now keeps
-- created_at and stamps updated_at instead.

ALTER TABLE model_surprise_results
    ADD COLUMN IF NOT EXISTS season_id  INT,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

UPDATE model_surprise_results
SET updated_at = created_at;

-- ESPN season id = the year the season ends (Oct 2026 -> 2027).
UPDATE model_surprise_results
SET season_id = EXTRACT(YEAR FROM game_date)::INT
              + CASE WHEN EXTRACT(MONTH FROM game_date) >= 8 THEN 1 ELSE 0 END
WHERE season_id IS NULL;
