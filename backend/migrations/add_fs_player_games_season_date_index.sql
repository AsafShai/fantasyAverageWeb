CREATE INDEX IF NOT EXISTS idx_fs_player_games_season_date
    ON fs_player_games (season, game_date);
