"""SQLAlchemy model for team_ranking output table (Monte Carlo expected points per stat)."""

from datetime import datetime
from decimal import Decimal
from typing import Optional

from sqlalchemy import DateTime, Numeric, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from .column_names import RankingExpectedPts
from .team_prediction import Base


class TeamRanking(Base):
    """
    Monte Carlo ranking output: one row per team per run.
    Expected ranking points per stat and total_expected_pts.
    """

    __tablename__ = "team_ranking"
    __table_args__ = (UniqueConstraint("run_id", "team_id", name="uq_team_ranking_run_team"),)

    Columns = RankingExpectedPts

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    run_id: Mapped[int] = mapped_column(nullable=False)
    team_id: Mapped[int] = mapped_column(nullable=False)
    team_name: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    rank: Mapped[int] = mapped_column(nullable=False)
    projected_total_gp: Mapped[Decimal] = mapped_column(Numeric, nullable=False)
    expected_pts_fg_pct: Mapped[Decimal] = mapped_column(Numeric, nullable=False)
    expected_pts_ft_pct: Mapped[Decimal] = mapped_column(Numeric, nullable=False)
    expected_pts_three_pm: Mapped[Decimal] = mapped_column(Numeric, nullable=False)
    expected_pts_reb: Mapped[Decimal] = mapped_column(Numeric, nullable=False)
    expected_pts_ast: Mapped[Decimal] = mapped_column(Numeric, nullable=False)
    expected_pts_stl: Mapped[Decimal] = mapped_column(Numeric, nullable=False)
    expected_pts_blk: Mapped[Decimal] = mapped_column(Numeric, nullable=False)
    expected_pts_pts: Mapped[Decimal] = mapped_column(Numeric, nullable=False)
    total_expected_pts: Mapped[Decimal] = mapped_column(Numeric, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
