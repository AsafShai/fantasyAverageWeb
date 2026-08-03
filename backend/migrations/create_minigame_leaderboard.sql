CREATE TABLE IF NOT EXISTS minigame_leaderboard (
    id SERIAL PRIMARY KEY,
    game_slug TEXT NOT NULL,
    display_name TEXT NOT NULL,
    best_streak INTEGER NOT NULL,
    hints_used INTEGER,
    achieved_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_leaderboard_game_score
    ON minigame_leaderboard (game_slug, best_streak DESC);
