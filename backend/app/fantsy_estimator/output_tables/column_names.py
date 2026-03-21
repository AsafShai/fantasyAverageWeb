"""Output column names for building DataFrames that match the output table models.

Used by the estimator when constructing predictions_df, ranking_df, rank_prob_df.
Schema is defined by the SQLAlchemy models in this package; these names stay in sync.
"""

# Stat names for estimated_final_* / variance_* / expected_pts_* (same order as models).
STAT_NAMES = (
    "fg_pct",
    "ft_pct",
    "three_pm",
    "reb",
    "ast",
    "stl",
    "blk",
    "pts",
)


class EstimatedFinal:
    """Estimated final value per stat (team_prediction table)."""

    FG_PCT = "estimated_final_fg_pct"
    FT_PCT = "estimated_final_ft_pct"
    THREE_PM = "estimated_final_three_pm"
    REB = "estimated_final_reb"
    AST = "estimated_final_ast"
    STL = "estimated_final_stl"
    BLK = "estimated_final_blk"
    PTS = "estimated_final_pts"

    @classmethod
    def all(cls) -> tuple[str, ...]:
        return (
            cls.FG_PCT,
            cls.FT_PCT,
            cls.THREE_PM,
            cls.REB,
            cls.AST,
            cls.STL,
            cls.BLK,
            cls.PTS,
        )

    @classmethod
    def for_stat(cls, stat: str) -> str:
        return f"estimated_final_{stat}"


class Variance:
    """Variance per stat (team_prediction table)."""

    FG_PCT = "variance_fg_pct"
    FT_PCT = "variance_ft_pct"
    THREE_PM = "variance_three_pm"
    REB = "variance_reb"
    AST = "variance_ast"
    STL = "variance_stl"
    BLK = "variance_blk"
    PTS = "variance_pts"

    @classmethod
    def all(cls) -> tuple[str, ...]:
        return (
            cls.FG_PCT,
            cls.FT_PCT,
            cls.THREE_PM,
            cls.REB,
            cls.AST,
            cls.STL,
            cls.BLK,
            cls.PTS,
        )

    @classmethod
    def for_stat(cls, stat: str) -> str:
        return f"variance_{stat}"


class Metadata:
    """Metadata columns (team_prediction table)."""

    NBA_AVG_PACE = "nba_avg_pace"
    CREATED_AT = "created_at"


class RankingExpectedPts:
    """Expected ranking points per stat (team_ranking table)."""

    FG_PCT = "expected_pts_fg_pct"
    FT_PCT = "expected_pts_ft_pct"
    THREE_PM = "expected_pts_three_pm"
    REB = "expected_pts_reb"
    AST = "expected_pts_ast"
    STL = "expected_pts_stl"
    BLK = "expected_pts_blk"
    PTS = "expected_pts_pts"
    TOTAL = "total_expected_pts"

    @classmethod
    def all(cls) -> tuple[str, ...]:
        return (
            cls.FG_PCT,
            cls.FT_PCT,
            cls.THREE_PM,
            cls.REB,
            cls.AST,
            cls.STL,
            cls.BLK,
            cls.PTS,
        )

    @classmethod
    def for_stat(cls, stat: str) -> str:
        return f"expected_pts_{stat}"


class OutputColumnNames:
    """All output column names by family; use when building output DataFrames."""

    STAT_NAMES = STAT_NAMES
    EstimatedFinal = EstimatedFinal
    Variance = Variance
    Metadata = Metadata
    RankingExpectedPts = RankingExpectedPts
