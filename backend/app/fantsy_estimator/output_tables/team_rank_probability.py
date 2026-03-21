"""SQLAlchemy model for team_rank_probability output table (P(team finishes in rank r))."""

from datetime import datetime
from decimal import Decimal
from typing import Optional

from sqlalchemy import DateTime, Numeric, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from .team_prediction import Base


class TeamRankProbability(Base):
    """
    Rank probability output: one row per (run_id, team_id, rank).
    Dynamic number of teams — no fixed prob_rank_1..prob_rank_N columns.
    """

    __tablename__ = "team_rank_probability"
    __table_args__ = (
        UniqueConstraint(
            "run_id", "team_id", "rank", name="uq_team_rank_probability_run_team_rank"
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    run_id: Mapped[int] = mapped_column(nullable=False)
    team_id: Mapped[int] = mapped_column(nullable=False)
    team_name: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    rank: Mapped[int] = mapped_column(nullable=False)  # 1 = 1st place, 2 = 2nd, ...
    prob: Mapped[Decimal] = mapped_column(Numeric, nullable=False)  # P(team finishes in this rank)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )