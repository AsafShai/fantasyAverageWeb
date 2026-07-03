-- Nightly model pipeline tables.
--
-- fs_player_games / fs_team_games hold the raw game rows that back the
-- model_stats_inference FeatureStore (source of truth; feature vectors are
-- recomputed in memory from these rows on every run). Columns are the subset
-- of the nba_api game-log schemas the feature pipeline actually consumes
-- (research/config.py BASE_STATS + meta, and the columns
-- build_team_allowed/build_team_own read from raw team logs).

CREATE TABLE IF NOT EXISTS fs_player_games (
    player_id   BIGINT NOT NULL,
    game_id     TEXT   NOT NULL,
    season      TEXT   NOT NULL,
    game_date   DATE   NOT NULL,
    player_name TEXT   NOT NULL DEFAULT '',
    team_id     BIGINT NOT NULL,
    matchup     TEXT   NOT NULL DEFAULT '',
    position    TEXT   NOT NULL DEFAULT '',
    min         DOUBLE PRECISION NOT NULL,
    pts         DOUBLE PRECISION NOT NULL,
    reb         DOUBLE PRECISION NOT NULL,
    oreb        DOUBLE PRECISION NOT NULL,
    dreb        DOUBLE PRECISION NOT NULL,
    ast         DOUBLE PRECISION NOT NULL,
    fg3m        DOUBLE PRECISION NOT NULL,
    fg3a        DOUBLE PRECISION NOT NULL,
    stl         DOUBLE PRECISION NOT NULL,
    blk         DOUBLE PRECISION NOT NULL,
    tov         DOUBLE PRECISION NOT NULL,
    fgm         DOUBLE PRECISION NOT NULL,
    fga         DOUBLE PRECISION NOT NULL,
    ftm         DOUBLE PRECISION NOT NULL,
    fta         DOUBLE PRECISION NOT NULL,
    pf          DOUBLE PRECISION NOT NULL,
    plus_minus  DOUBLE PRECISION NOT NULL,
    PRIMARY KEY (player_id, game_id)
);
CREATE INDEX IF NOT EXISTS idx_fs_player_games_date ON fs_player_games (game_date);

CREATE TABLE IF NOT EXISTS fs_team_games (
    team_id   BIGINT NOT NULL,
    game_id   TEXT   NOT NULL,
    season    TEXT   NOT NULL,
    game_date DATE   NOT NULL,
    team_name TEXT   NOT NULL DEFAULT '',
    matchup   TEXT   NOT NULL DEFAULT '',
    pts       DOUBLE PRECISION NOT NULL,
    reb       DOUBLE PRECISION NOT NULL,
    ast       DOUBLE PRECISION NOT NULL,
    stl       DOUBLE PRECISION NOT NULL,
    blk       DOUBLE PRECISION NOT NULL,
    fg3m      DOUBLE PRECISION NOT NULL,
    fg_pct    DOUBLE PRECISION NOT NULL,
    fga       DOUBLE PRECISION NOT NULL,
    fta       DOUBLE PRECISION NOT NULL,
    tov       DOUBLE PRECISION NOT NULL,
    PRIMARY KEY (team_id, game_id)
);
CREATE INDEX IF NOT EXISTS idx_fs_team_games_date ON fs_team_games (game_date);

-- One row per processed night: the idempotency ledger for the morning job.
CREATE TABLE IF NOT EXISTS model_nightly_runs (
    game_date DATE PRIMARY KEY,
    status    TEXT NOT NULL,            -- 'processed' | 'no_games' | 'store_already_ingested'
    num_games INT  NOT NULL DEFAULT 0,
    num_rows  INT  NOT NULL DEFAULT 0,
    ran_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Predicted-vs-actual per player per game. Predictions are retro: computed with
-- the minutes the player actually played, from feature-store state that excludes
-- the game itself. pred_* are NULL when the player was ineligible (see reason).
CREATE TABLE IF NOT EXISTS model_eval_results (
    game_id          TEXT   NOT NULL,
    player_id        BIGINT NOT NULL,
    game_date        DATE   NOT NULL,
    player_name      TEXT   NOT NULL DEFAULT '',
    team_id          BIGINT NOT NULL,
    opponent_team_id BIGINT NOT NULL,
    is_home          BOOLEAN NOT NULL,
    minutes          DOUBLE PRECISION NOT NULL,
    eligible         BOOLEAN NOT NULL,
    reason           TEXT NOT NULL DEFAULT '',
    pred_pts    DOUBLE PRECISION,
    pred_reb    DOUBLE PRECISION,
    pred_ast    DOUBLE PRECISION,
    pred_fg3m   DOUBLE PRECISION,
    pred_stl    DOUBLE PRECISION,
    pred_blk    DOUBLE PRECISION,
    pred_fgm    DOUBLE PRECISION,
    pred_fga    DOUBLE PRECISION,
    pred_ftm    DOUBLE PRECISION,
    pred_fta    DOUBLE PRECISION,
    actual_pts  DOUBLE PRECISION NOT NULL,
    actual_reb  DOUBLE PRECISION NOT NULL,
    actual_ast  DOUBLE PRECISION NOT NULL,
    actual_fg3m DOUBLE PRECISION NOT NULL,
    actual_stl  DOUBLE PRECISION NOT NULL,
    actual_blk  DOUBLE PRECISION NOT NULL,
    actual_fgm  DOUBLE PRECISION NOT NULL,
    actual_fga  DOUBLE PRECISION NOT NULL,
    actual_ftm  DOUBLE PRECISION NOT NULL,
    actual_fta  DOUBLE PRECISION NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (game_id, player_id)
);
CREATE INDEX IF NOT EXISTS idx_model_eval_results_game_date ON model_eval_results (game_date);
CREATE INDEX IF NOT EXISTS idx_model_eval_results_player ON model_eval_results (player_id, game_date);
