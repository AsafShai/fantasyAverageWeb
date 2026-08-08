-- Safe for docker-entrypoint-initdb.d alphabetical order: this file name
-- sorts before create_model_pipeline_tables.sql, so the table may not exist yet.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'fs_player_games'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_fs_player_games_season_date
      ON fs_player_games (season, game_date);
  END IF;
END $$;
