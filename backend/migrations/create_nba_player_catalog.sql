CREATE TABLE IF NOT EXISTS nba_player_catalog_meta (
    id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    season_label TEXT NOT NULL,
    source TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS nba_player_catalog (
    player_id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    team TEXT NOT NULL,
    team_abbr TEXT NOT NULL,
    conference TEXT NOT NULL,
    division TEXT NOT NULL,
    position TEXT NOT NULL,
    photo_url TEXT,
    height TEXT,
    nationality TEXT,
    age INTEGER,
    jersey_number TEXT
);

CREATE INDEX IF NOT EXISTS idx_nba_player_catalog_team_abbr
    ON nba_player_catalog (team_abbr);

CREATE INDEX IF NOT EXISTS idx_nba_player_catalog_display_name_lower
    ON nba_player_catalog (LOWER(display_name));
