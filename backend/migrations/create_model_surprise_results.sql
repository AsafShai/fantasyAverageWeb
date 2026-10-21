-- Surprises of the night: one row per player-game scored by the nightly job
-- (model_stats_inference/serving/surprise.py), feeding the "Boom or Bust" tab.
-- score is on an N(0,1) scale against the reference season; positive = good
-- surprise, negative = disappointment. verdict is 'good' / 'bad' past the
-- server thresholds, '' otherwise. has_estimate is false when the player had no
-- model estimate yet and was scored on his own history alone.

CREATE TABLE IF NOT EXISTS model_surprise_results (
    game_id          TEXT    NOT NULL,
    player_id        BIGINT  NOT NULL,
    game_date        DATE    NOT NULL,
    player_name      TEXT    NOT NULL DEFAULT '',
    team_id          BIGINT  NOT NULL,
    opponent_team_id BIGINT  NOT NULL,
    is_home          BOOLEAN NOT NULL,
    minutes          DOUBLE PRECISION NOT NULL,
    pts  DOUBLE PRECISION NOT NULL,
    reb  DOUBLE PRECISION NOT NULL,
    ast  DOUBLE PRECISION NOT NULL,
    fg3m DOUBLE PRECISION NOT NULL,
    stl  DOUBLE PRECISION NOT NULL,
    blk  DOUBLE PRECISION NOT NULL,
    fgm  DOUBLE PRECISION NOT NULL,
    fga  DOUBLE PRECISION NOT NULL,
    ftm  DOUBLE PRECISION NOT NULL,
    fta  DOUBLE PRECISION NOT NULL,
    metric_z     DOUBLE PRECISION,
    metric_err   DOUBLE PRECISION,
    score        DOUBLE PRECISION,
    has_estimate BOOLEAN NOT NULL DEFAULT FALSE,
    verdict      TEXT    NOT NULL DEFAULT '',
    reasons      JSONB   NOT NULL DEFAULT '[]',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (game_id, player_id)
);
CREATE INDEX IF NOT EXISTS idx_model_surprise_results_game_date ON model_surprise_results (game_date);
