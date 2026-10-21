-- Boom or Bust: where each player was in the league on the night (added after
-- the table first shipped, so it is its own migration: CREATE TABLE IF NOT
-- EXISTS never adds columns to an existing table).
--   fantasy_team_id / fantasy_team  the fantasy team that rostered him that night
--                                   (NULL = free agent / unknown)
--   lineup_slot                     the slot he sat in (BE / IR = not started)
ALTER TABLE model_surprise_results
    ADD COLUMN IF NOT EXISTS fantasy_team_id BIGINT,
    ADD COLUMN IF NOT EXISTS fantasy_team    TEXT,
    ADD COLUMN IF NOT EXISTS lineup_slot     TEXT;
