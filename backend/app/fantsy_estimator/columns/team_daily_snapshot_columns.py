"""Column names for team daily snapshot dataframe (user-provided df)."""


class TeamDailySnapshotColumns:
    """All column names for the team_daily_snapshot-style dataframe the user will enter."""

    ID = "id"
    SCORING_PERIOD_ID = "scoring_period_id"
    DATE = "date"
    TEAM_ID = "team_id"
    TEAM_NAME = "team_name"
    GP = "gp"
    FGM = "fgm"
    FGA = "fga"
    FG_PCT = "fg_pct"
    FTM = "ftm"
    FTA = "fta"
    FT_PCT = "ft_pct"
    THREE_PM = "three_pm"
    REB = "reb"
    AST = "ast"
    STL = "stl"
    BLK = "blk"
    PTS = "pts"
    CREATED_AT = "created_at"

    @classmethod
    def all(cls) -> tuple[str, ...]:
        """Return all column names in order."""
        return (
            cls.ID,
            cls.SCORING_PERIOD_ID,
            cls.DATE,
            cls.TEAM_ID,
            cls.TEAM_NAME,
            cls.GP,
            cls.FGM,
            cls.FGA,
            cls.FG_PCT,
            cls.FTM,
            cls.FTA,
            cls.FT_PCT,
            cls.THREE_PM,
            cls.REB,
            cls.AST,
            cls.STL,
            cls.BLK,
            cls.PTS,
            cls.CREATED_AT,
        )
