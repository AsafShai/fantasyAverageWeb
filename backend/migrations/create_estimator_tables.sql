CREATE TABLE IF NOT EXISTS estimator_prediction (
    team_id INT PRIMARY KEY,
    team_name TEXT NOT NULL,
    as_of_date DATE NOT NULL,
    projected_total_gp FLOAT,
    estimated_final_fg_pct FLOAT,
    estimated_final_ft_pct FLOAT,
    estimated_final_three_pm FLOAT,
    estimated_final_reb FLOAT,
    estimated_final_ast FLOAT,
    estimated_final_stl FLOAT,
    estimated_final_blk FLOAT,
    estimated_final_pts FLOAT,
    variance_fg_pct FLOAT,
    variance_ft_pct FLOAT,
    variance_three_pm FLOAT,
    variance_reb FLOAT,
    variance_ast FLOAT,
    variance_stl FLOAT,
    variance_blk FLOAT,
    variance_pts FLOAT,
    nba_avg_pace FLOAT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS estimator_ranking (
    team_id INT PRIMARY KEY,
    team_name TEXT NOT NULL,
    rank INT NOT NULL,
    total_expected_pts FLOAT,
    expected_pts_fg_pct FLOAT,
    expected_pts_ft_pct FLOAT,
    expected_pts_three_pm FLOAT,
    expected_pts_reb FLOAT,
    expected_pts_ast FLOAT,
    expected_pts_stl FLOAT,
    expected_pts_blk FLOAT,
    expected_pts_pts FLOAT,
    projected_total_gp FLOAT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS estimator_rank_probability (
    id SERIAL,
    team_id INT NOT NULL,
    team_name TEXT NOT NULL,
    rank INT NOT NULL,
    prob FLOAT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (team_id, rank)
);
