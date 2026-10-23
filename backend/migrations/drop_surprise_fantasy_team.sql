-- Boom or Bust, step 2 of add_surprise_season_scope.sql.
-- Apply only AFTER the code that writes season_id is deployed: the old code
-- still writes fantasy_team and leaves season_id NULL.

UPDATE model_surprise_results
SET season_id = EXTRACT(YEAR FROM game_date)::INT
              + CASE WHEN EXTRACT(MONTH FROM game_date) >= 8 THEN 1 ELSE 0 END
WHERE season_id IS NULL;

ALTER TABLE model_surprise_results
    ALTER COLUMN season_id SET NOT NULL,
    DROP COLUMN IF EXISTS fantasy_team;
