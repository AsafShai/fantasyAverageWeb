-- Rank columns were INTEGER, truncating the .5 fractions pandas .rank(method='average')
-- produces on ties. Widen to NUMERIC(5,1) so tied roto ranks keep their averaged value.
ALTER TABLE team_rankings_averages
    ALTER COLUMN rk_fg_pct   TYPE NUMERIC(5,1),
    ALTER COLUMN rk_ft_pct   TYPE NUMERIC(5,1),
    ALTER COLUMN rk_three_pm TYPE NUMERIC(5,1),
    ALTER COLUMN rk_reb      TYPE NUMERIC(5,1),
    ALTER COLUMN rk_ast      TYPE NUMERIC(5,1),
    ALTER COLUMN rk_stl      TYPE NUMERIC(5,1),
    ALTER COLUMN rk_blk      TYPE NUMERIC(5,1),
    ALTER COLUMN rk_pts      TYPE NUMERIC(5,1),
    ALTER COLUMN rk_total    TYPE NUMERIC(5,1);

ALTER TABLE team_rankings_totals
    ALTER COLUMN rk_fg_pct   TYPE NUMERIC(5,1),
    ALTER COLUMN rk_ft_pct   TYPE NUMERIC(5,1),
    ALTER COLUMN rk_three_pm TYPE NUMERIC(5,1),
    ALTER COLUMN rk_reb      TYPE NUMERIC(5,1),
    ALTER COLUMN rk_ast      TYPE NUMERIC(5,1),
    ALTER COLUMN rk_stl      TYPE NUMERIC(5,1),
    ALTER COLUMN rk_blk      TYPE NUMERIC(5,1),
    ALTER COLUMN rk_pts      TYPE NUMERIC(5,1),
    ALTER COLUMN rk_total    TYPE NUMERIC(5,1);
