-- Rank probability: one row per (run_id, team_id, rank). Dynamic number of teams.
CREATE TABLE IF NOT EXISTS team_rank_probability (
    id SERIAL PRIMARY KEY,
    run_id INTEGER NOT NULL,
    team_id INTEGER NOT NULL,
    team_name VARCHAR(100),
    rank INTEGER NOT NULL,
    prob NUMERIC NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_team_rank_probability_run_team_rank UNIQUE (run_id, team_id, rank)
);