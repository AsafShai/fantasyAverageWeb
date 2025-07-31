from pydantic import BaseModel
from typing import List, Dict
from datetime import datetime
from .base import Team
from .stats import ShotChartStats, TeamAverageStats, RankingStats, PlayerStats

class TeamDetail(BaseModel):
    team: Team
    shot_chart: ShotChartStats
    raw_averages: TeamAverageStats
    ranking_stats: RankingStats
    category_ranks: Dict[str, int]

class Player(BaseModel):
    player_name: str
    pro_team: str
    positions: List[str]
    stats: PlayerStats

class TeamPlayers(BaseModel):
    team_id: int
    players: List[Player]
    last_updated: datetime 