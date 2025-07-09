from pydantic import BaseModel
from typing import List, Optional, Dict
from datetime import datetime

class ShotChartStats(BaseModel):
    team: str
    fgm: int  # Field Goals Made
    fga: int  # Field Goals Attempted
    fg_percentage: float  # Field Goal Percentage
    ftm: int  # Free Throws Made
    fta: int  # Free Throws Attempted
    ft_percentage: float  # Free Throw Percentage
    gp: int  # Games Played

class RawAverageStats(BaseModel):
    team: str
    fg_percentage: float
    ft_percentage: float
    three_pm: float  # 3-Pointers Made
    ast: float  # Assists
    reb: float  # Rebounds
    stl: float  # Steals
    blk: float  # Blocks
    pts: float  # Points
    gp: int  # Games Played

class RankingStats(BaseModel):
    team: str
    fg_percentage: float
    ft_percentage: float
    three_pm: float
    ast: float
    reb: float
    stl: float
    blk: float
    pts: float
    total_points: float
    rank: Optional[int] = None

class TeamDetail(BaseModel):
    team: str
    shot_chart: ShotChartStats
    raw_averages: RawAverageStats
    ranking_stats: RankingStats
    category_ranks: Dict[str, int]

class LeagueRankings(BaseModel):
    rankings: List[RankingStats]
    categories: List[str]
    last_updated: datetime

class LeagueSummary(BaseModel):
    total_teams: int
    total_games_played: int
    category_leaders: Dict[str, RankingStats]
    league_averages: Optional[RawAverageStats] = None
    last_updated: datetime

class HeatmapData(BaseModel):
    teams: List[str]
    categories: List[str]
    data: List[List[float]]
    normalized_data: List[List[float]]

class TeamShotStats(BaseModel):
    team: str
    fgm: int  # Field Goals Made
    fga: int  # Field Goals Attempted
    fg_percentage: float  # Field Goal Percentage
    ftm: int  # Free Throws Made
    fta: int  # Free Throws Attempted
    ft_percentage: float  # Free Throw Percentage
    gp: int  # Games Played

class LeagueShotsData(BaseModel):
    shots: List[TeamShotStats]
    last_updated: datetime