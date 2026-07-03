-- Materialized feature vectors: the "as of now" state per player/team, rebuilt
-- and upserted every morning after the nightly ingest. These are DERIVED from
-- fs_player_games/fs_team_games (the source of truth) — kept here only so a live
-- inference path can load ready-to-use vectors without recomputing.
--
-- Feature values live in a JSONB blob (feature_name -> value) because the set is
-- large (~150 per player) and config-driven; NaN is stored as JSON null.

CREATE TABLE IF NOT EXISTS fs_player_vectors (
    player_id      BIGINT PRIMARY KEY,
    player_name    TEXT   NOT NULL DEFAULT '',
    team_id        BIGINT NOT NULL,
    position       TEXT   NOT NULL DEFAULT '',
    last_game_date DATE,
    games_count    INT    NOT NULL DEFAULT 0,
    eligible       BOOLEAN NOT NULL DEFAULT FALSE,   -- games_count >= MIN_INFERENCE_GAMES
    features       JSONB  NOT NULL,
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS fs_team_allowed_vectors (
    team_id    BIGINT PRIMARY KEY,
    features   JSONB  NOT NULL,          -- OPP_ALLOWED_* (defense: what opponents produce)
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS fs_team_own_vectors (
    team_id    BIGINT PRIMARY KEY,
    features   JSONB  NOT NULL,          -- TEAM_* (own offensive context / pace)
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
