-- Tables that predate backend/migrations (they were created by hand in Neon).
-- Shapes inferred from DBService's INSERT/SELECT statements; the migrations
-- (add_league_season_scope.sql, add_dynamic_category_columns.sql) then add
-- league/season scope and the JSONB columns exactly as in production.
CREATE TABLE IF NOT EXISTS team_daily_snapshot (
    scoring_period_id INT NOT NULL,
    date DATE NOT NULL,
    team_id INT NOT NULL,
    team_name TEXT NOT NULL,
    gp INT, fgm INT, fga INT, fg_pct DOUBLE PRECISION,
    ftm INT, fta INT, ft_pct DOUBLE PRECISION,
    three_pm INT, reb INT, ast INT, stl INT, blk INT, pts INT,
    PRIMARY KEY (scoring_period_id, team_id)
);
CREATE TABLE IF NOT EXISTS team_rankings_averages (
    scoring_period_id INT NOT NULL,
    date DATE NOT NULL,
    team_id INT NOT NULL,
    team_name TEXT NOT NULL,
    rk_fg_pct DOUBLE PRECISION, rk_ft_pct DOUBLE PRECISION, rk_three_pm DOUBLE PRECISION,
    rk_reb DOUBLE PRECISION, rk_ast DOUBLE PRECISION, rk_stl DOUBLE PRECISION,
    rk_blk DOUBLE PRECISION, rk_pts DOUBLE PRECISION, rk_total DOUBLE PRECISION,
    PRIMARY KEY (scoring_period_id, team_id)
);
CREATE TABLE IF NOT EXISTS team_rankings_totals (
    scoring_period_id INT NOT NULL,
    date DATE NOT NULL,
    team_id INT NOT NULL,
    team_name TEXT NOT NULL,
    rk_fg_pct DOUBLE PRECISION, rk_ft_pct DOUBLE PRECISION, rk_three_pm DOUBLE PRECISION,
    rk_reb DOUBLE PRECISION, rk_ast DOUBLE PRECISION, rk_stl DOUBLE PRECISION,
    rk_blk DOUBLE PRECISION, rk_pts DOUBLE PRECISION, rk_total DOUBLE PRECISION,
    PRIMARY KEY (scoring_period_id, team_id)
);
