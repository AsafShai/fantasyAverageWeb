-- Monte Carlo ranking: expected points per stat and total per team per run
CREATE TABLE IF NOT EXISTS team_ranking (
    id SERIAL PRIMARY KEY,
    run_id INTEGER NOT NULL,
    team_id INTEGER NOT NULL,
    team_name VARCHAR(100),
    rank INTEGER NOT NULL,
    projected_total_gp NUMERIC NOT NULL,
    expected_pts_fg_pct NUMERIC NOT NULL,
    expected_pts_ft_pct NUMERIC NOT NULL,
    expected_pts_three_pm NUMERIC NOT NULL,
    expected_pts_reb NUMERIC NOT NULL,
    expected_pts_ast NUMERIC NOT NULL,
    expected_pts_stl NUMERIC NOT NULL,
    expected_pts_blk NUMERIC NOT NULL,
    expected_pts_pts NUMERIC NOT NULL,
    total_expected_pts NUMERIC NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_team_ranking_run_team UNIQUE (run_id, team_id)
);
