-- Which NBA team each player was on, and when, for the current season.
-- Rebuilt every night from the NBA Player Movement feed plus ESPN box-score
-- appearances (app/services/roster_stints). Feeds the With / Without page:
-- a player "sat" a game when the game falls inside one of his stints for that
-- team and he has no played row in fs_player_games.

CREATE TABLE IF NOT EXISTS nba_roster_stints (
    season      TEXT    NOT NULL,
    player_id   BIGINT  NOT NULL,      -- ESPN athlete id
    player_name TEXT    NOT NULL DEFAULT '',
    position    TEXT    NOT NULL DEFAULT '',
    team_id     BIGINT  NOT NULL,      -- ESPN team id (1-30)
    start_date  DATE    NOT NULL,
    end_date    DATE,                  -- NULL = still on the team
    two_way     BOOLEAN NOT NULL DEFAULT FALSE,
    source      TEXT    NOT NULL,      -- 'feed' | 'feed+box' | 'box' | 'box_only'
    PRIMARY KEY (season, player_id, team_id, start_date)
);

CREATE INDEX IF NOT EXISTS idx_nba_roster_stints_team ON nba_roster_stints (season, team_id);
