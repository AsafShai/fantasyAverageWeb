-- Pre-game projection snapshots for the Model vs. Reality page.
--
-- model_eval_results is retro (predicted with the minutes actually played), so
-- it can't say how good the projection users saw before tip-off was. This table
-- keeps that projection exactly as served: default minutes (last-5 average) and
-- the stat line from the resident store, plus the player's last-10 average at
-- the same moment (the baseline the page compares against).
--
-- Written for the upcoming slate after the morning nightly run, and written
-- through by /matchups/today for any game still in its 'pre' state (first write
-- wins unless a newer store produced it). The nightly job fills the actual_*
-- columns from fs_player_games / fs_team_games once the night is ingested.
-- IDs are ESPN-native, same as fs_player_games.

CREATE TABLE IF NOT EXISTS model_pregame_projections (
    game_date        DATE   NOT NULL,
    player_id        BIGINT NOT NULL,
    player_name      TEXT   NOT NULL DEFAULT '',
    team_id          BIGINT NOT NULL,
    opponent_team_id BIGINT NOT NULL,
    is_home          BOOLEAN NOT NULL,
    proj_min         DOUBLE PRECISION NOT NULL,
    status           TEXT   NOT NULL,           -- green | amber (red = no projection, not stored)
    status_reason    TEXT   NOT NULL DEFAULT '',
    injury_status    TEXT,                      -- injury report entry at snapshot time
    pred_pts    DOUBLE PRECISION NOT NULL,
    pred_reb    DOUBLE PRECISION NOT NULL,
    pred_ast    DOUBLE PRECISION NOT NULL,
    pred_fg3m   DOUBLE PRECISION NOT NULL,
    pred_stl    DOUBLE PRECISION NOT NULL,
    pred_blk    DOUBLE PRECISION NOT NULL,
    pred_fgm    DOUBLE PRECISION NOT NULL,
    pred_fga    DOUBLE PRECISION NOT NULL,
    pred_ftm    DOUBLE PRECISION NOT NULL,
    pred_fta    DOUBLE PRECISION NOT NULL,
    pred_fg_pct DOUBLE PRECISION NOT NULL,
    pred_ft_pct DOUBLE PRECISION NOT NULL,
    -- Last-10-appearance averages at snapshot time; NULL for a player with no
    -- stored games yet.
    base_min    DOUBLE PRECISION,
    base_pts    DOUBLE PRECISION,
    base_reb    DOUBLE PRECISION,
    base_ast    DOUBLE PRECISION,
    base_fg3m   DOUBLE PRECISION,
    base_stl    DOUBLE PRECISION,
    base_blk    DOUBLE PRECISION,
    base_fgm    DOUBLE PRECISION,
    base_fga    DOUBLE PRECISION,
    base_ftm    DOUBLE PRECISION,
    base_fta    DOUBLE PRECISION,
    store_through DATE,                         -- newest night the store had ingested
    model_version TEXT NOT NULL DEFAULT '',     -- short hash of models/model_card.json
    snapshot_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Filled by the nightly reconcile step.
    game_id       TEXT,
    outcome       TEXT,                         -- played | dnp | no_game; NULL = pending
    actual_min    DOUBLE PRECISION,
    actual_pts    DOUBLE PRECISION,
    actual_reb    DOUBLE PRECISION,
    actual_ast    DOUBLE PRECISION,
    actual_fg3m   DOUBLE PRECISION,
    actual_stl    DOUBLE PRECISION,
    actual_blk    DOUBLE PRECISION,
    actual_fgm    DOUBLE PRECISION,
    actual_fga    DOUBLE PRECISION,
    actual_ftm    DOUBLE PRECISION,
    actual_fta    DOUBLE PRECISION,
    actual_pf     DOUBLE PRECISION,
    team_margin   DOUBLE PRECISION,             -- player's team points minus opponent's
    reconciled_at TIMESTAMPTZ,
    PRIMARY KEY (game_date, player_id)
);
CREATE INDEX IF NOT EXISTS idx_model_pregame_projections_player
    ON model_pregame_projections (player_id, game_date);
CREATE INDEX IF NOT EXISTS idx_model_pregame_projections_pending
    ON model_pregame_projections (game_date) WHERE reconciled_at IS NULL;
