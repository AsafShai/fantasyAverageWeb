"""Output table models (e.g. Phase 1 team_prediction, SQLAlchemy)."""

from .team_prediction import Base, TeamPrediction
from .team_ranking import TeamRanking
from .team_rank_probability import TeamRankProbability

__all__ = ["Base", "TeamPrediction", "TeamRanking", "TeamRankProbability"]
