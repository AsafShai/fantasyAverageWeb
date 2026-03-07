from pydantic import BaseModel
from typing import List, Dict, Optional
from datetime import datetime, date
from .base import Team
from .stats import ShotChartStats, TeamAverageStats, RankingStats, SlotUsage
from .player import Player

class TeamDetail(BaseModel):
    team: Team
    espn_url: str
    players: Optional[List[Player]] = None
    shot_chart: ShotChartStats
    raw_averages: TeamAverageStats
    ranking_stats: RankingStats
    category_ranks: Dict[str, int]
    slot_usage: Dict[str, SlotUsage]
    data_date: Optional[date] = None

class TeamPlayers(BaseModel):
    team_id: int
    players: List[Player]
    last_updated: datetime