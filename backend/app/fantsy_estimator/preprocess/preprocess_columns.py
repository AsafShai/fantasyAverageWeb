"""Column names for the new columns added by the snapshot preprocess (avg in period, gp in period)."""


class PreprocessColumns:
    """
    Names of columns added by the preprocess step.
    Use these to reference the new columns (e.g. df[PreprocessColumns.AVG_PTS_IN_PERIOD]).
    """

    GP_IN_PERIOD = "gp_in_period"
    PERIOD_INDEX = "period_index"  # team-local period id (1, 2, 3, ...) after per-team clean
    AVG_FGM_IN_PERIOD = "avg_fgm_in_period"
    AVG_FGA_IN_PERIOD = "avg_fga_in_period"
    AVG_FTM_IN_PERIOD = "avg_ftm_in_period"
    AVG_FTA_IN_PERIOD = "avg_fta_in_period"
    AVG_THREE_PM_IN_PERIOD = "avg_three_pm_in_period"
    AVG_REB_IN_PERIOD = "avg_reb_in_period"
    AVG_AST_IN_PERIOD = "avg_ast_in_period"
    AVG_STL_IN_PERIOD = "avg_stl_in_period"
    AVG_BLK_IN_PERIOD = "avg_blk_in_period"
    AVG_PTS_IN_PERIOD = "avg_pts_in_period"

    # Sum stats we add as averages (order for iteration)
    SUM_STAT_COLUMNS = (
        "fgm",
        "fga",
        "ftm",
        "fta",
        "three_pm",
        "reb",
        "ast",
        "stl",
        "blk",
        "pts",
    )

    # Map snapshot sum column name -> new avg column name
    STAT_TO_AVG_COLUMN: dict[str, str] = {
        "fgm": AVG_FGM_IN_PERIOD,
        "fga": AVG_FGA_IN_PERIOD,
        "ftm": AVG_FTM_IN_PERIOD,
        "fta": AVG_FTA_IN_PERIOD,
        "three_pm": AVG_THREE_PM_IN_PERIOD,
        "reb": AVG_REB_IN_PERIOD,
        "ast": AVG_AST_IN_PERIOD,
        "stl": AVG_STL_IN_PERIOD,
        "blk": AVG_BLK_IN_PERIOD,
        "pts": AVG_PTS_IN_PERIOD,
    }

    @classmethod
    def all_new(cls) -> tuple[str, ...]:
        """All new column names added by preprocess (gp_in_period first, then avg_*)."""
        return (
            cls.GP_IN_PERIOD,
            cls.AVG_FGM_IN_PERIOD,
            cls.AVG_FGA_IN_PERIOD,
            cls.AVG_FTM_IN_PERIOD,
            cls.AVG_FTA_IN_PERIOD,
            cls.AVG_THREE_PM_IN_PERIOD,
            cls.AVG_REB_IN_PERIOD,
            cls.AVG_AST_IN_PERIOD,
            cls.AVG_STL_IN_PERIOD,
            cls.AVG_BLK_IN_PERIOD,
            cls.AVG_PTS_IN_PERIOD,
        )
