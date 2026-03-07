from pydantic import BaseModel
from typing import List, Optional, Dict
from datetime import datetime, date
from .base import Team
from .stats import RankingStats, AverageStats, TeamShotStats

class LeagueRankings(BaseModel):
    rankings: List[RankingStats]
    categories: List[str]
    last_updated: datetime
    data_date: Optional[date] = None

class LeagueSummary(BaseModel):
    total_teams: int
    total_games_played: int
    nba_avg_pace: Optional[float] = None
    nba_game_days_left: Optional[int] = None
    category_leaders: Dict[str, RankingStats]
    league_averages: Optional[AverageStats] = None
    last_updated: datetime
    data_date: Optional[date] = None

class LeagueShotsData(BaseModel):
    shots: List[TeamShotStats]
    last_updated: datetime
    data_date: Optional[date] = None

class HeatmapData(BaseModel):
    teams: List[Team]
    categories: List[str]
    data: List[List[float]]
    normalized_data: List[List[float]]
    ranks_data: List[List[int]]
    data_date: Optional[date] = None

class TeamTimeSeriesPoint(BaseModel):
    date: date
    team_id: int
    team_name: str
    rk_fg_pct: Optional[int] = None
    rk_ft_pct: Optional[int] = None
    rk_three_pm: Optional[int] = None
    rk_reb: Optional[int] = None
    rk_ast: Optional[int] = None
    rk_stl: Optional[int] = None
    rk_blk: Optional[int] = None
    rk_pts: Optional[int] = None
    rk_total: Optional[int] = None
    fg_pct: Optional[float] = None
    ft_pct: Optional[float] = None
    three_pm: Optional[float] = None
    reb: Optional[float] = None
    ast: Optional[float] = None
    stl: Optional[float] = None
    blk: Optional[float] = None
    pts: Optional[float] = None

class RankingsOverTimeResponse(BaseModel):
    data: List[TeamTimeSeriesPoint]