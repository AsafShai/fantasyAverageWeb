"""SQLAlchemy model for Phase 1 team_prediction output table."""

from datetime import date, datetime
from decimal import Decimal
from typing import Optional

from sqlalchemy import Date, DateTime, Numeric, String, UniqueConstraint, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from .column_names import OutputColumnNames


class Base(DeclarativeBase):
    """Declarative base for output table models."""

    pass


class TeamPrediction(Base):
    """
    Phase 1 output: one row per team per run.
    For each stat: estimated_final_<stat> and variance_<stat>.

    Column families (for queries/iteration):
        OutputColumnNames.EstimatedFinal — estimated_final_* per stat
        OutputColumnNames.Variance   — variance_* per stat
        OutputColumnNames.Metadata   — nba_avg_pace, created_at
    """

    __tablename__ = "team_prediction"
    __table_args__ = (UniqueConstraint("run_id", "team_id", name="uq_team_prediction_run_team"),)

    Columns = OutputColumnNames

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    run_id: Mapped[int] = mapped_column(nullable=False)
    team_id: Mapped[int] = mapped_column(nullable=False)
    team_name: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    as_of_date: Mapped[date] = mapped_column(Date, nullable=False)
    projected_total_gp: Mapped[Decimal] = mapped_column(Numeric, nullable=False)
    # Per-stat: estimated_final + variance (8 stats)
    estimated_final_fg_pct: Mapped[Decimal] = mapped_column(Numeric, nullable=False)
    variance_fg_pct: Mapped[Decimal] = mapped_column(Numeric, nullable=False)
    estimated_final_ft_pct: Mapped[Decimal] = mapped_column(Numeric, nullable=False)
    variance_ft_pct: Mapped[Decimal] = mapped_column(Numeric, nullable=False)
    estimated_final_three_pm: Mapped[Decimal] = mapped_column(Numeric, nullable=False)
    variance_three_pm: Mapped[Decimal] = mapped_column(Numeric, nullable=False)
    estimated_final_reb: Mapped[Decimal] = mapped_column(Numeric, nullable=False)
    variance_reb: Mapped[Decimal] = mapped_column(Numeric, nullable=False)
    estimated_final_ast: Mapped[Decimal] = mapped_column(Numeric, nullable=False)
    variance_ast: Mapped[Decimal] = mapped_column(Numeric, nullable=False)
    estimated_final_stl: Mapped[Decimal] = mapped_column(Numeric, nullable=False)
    variance_stl: Mapped[Decimal] = mapped_column(Numeric, nullable=False)
    estimated_final_blk: Mapped[Decimal] = mapped_column(Numeric, nullable=False)
    variance_blk: Mapped[Decimal] = mapped_column(Numeric, nullable=False)
    estimated_final_pts: Mapped[Decimal] = mapped_column(Numeric, nullable=False)
    variance_pts: Mapped[Decimal] = mapped_column(Numeric, nullable=False)
    nba_avg_pace: Mapped[Optional[Decimal]] = mapped_column(Numeric, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
