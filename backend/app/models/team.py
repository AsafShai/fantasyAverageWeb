from pydantic import BaseModel
from typing import List, Dict
from datetime import datetime
from .base import Team
from .stats import ShotChartStats, TeamAverageStats, RankingStats
from .player import Player

class TeamDetail(BaseModel):
    team: Team
    espn_url: str
    players: List[Player]
    shot_chart: ShotChartStats
    raw_averages: TeamAverageStats
    ranking_stats: RankingStats
    category_ranks: Dict[str, int]

class TeamPlayers(BaseModel):
    team_id: int
    players: List[Player]
    last_updated: datetime