CREATE TABLE IF NOT EXISTS player_injury_status (
    team          TEXT NOT NULL,
    player        TEXT NOT NULL,
    status        TEXT NOT NULL,
    injury_reason TEXT NOT NULL DEFAULT '',
    last_updated  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (team, player)
);
