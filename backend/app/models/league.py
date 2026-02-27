from pydantic import BaseModel
from typing import List, Optional, Dict
from datetime import datetime
from .base import Team
from .stats import RankingStats, AverageStats, TeamShotStats

class LeagueRankings(BaseModel):
    rankings: List[RankingStats]
    categories: List[str]
    last_updated: datetime

class LeagueSummary(BaseModel):
    total_teams: int
    total_games_played: int
    nba_avg_pace: Optional[float] = None
    nba_game_days_left: Optional[int] = None
    category_leaders: Dict[str, RankingStats]
    league_averages: Optional[AverageStats] = None
    last_updated: datetime

class LeagueShotsData(BaseModel):
    shots: List[TeamShotStats]
    last_updated: datetime

class HeatmapData(BaseModel):
    teams: List[Team]
    categories: List[str]
    data: List[List[float]]
    normalized_data: List[List[float]]
    ranks_data: List[List[int]] 