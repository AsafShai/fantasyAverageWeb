from pydantic import BaseModel
from typing import Optional
from .base import Team


class SlotUsage(BaseModel):
    games_used: int
    cap: int
    remaining: int

class AverageStats(BaseModel):
    fg_percentage: float
    ft_percentage: float
    three_pm: float  # 3-Pointers Made
    ast: float  # Assists
    reb: float  # Rebounds
    stl: float  # Steals
    blk: float  # Blocks
    pts: float  # Points
    gp: float  # Games Played

class TeamAverageStats(AverageStats):
    team: Team

class ShotChartStats(BaseModel):
    team: Team
    fgm: int  # Field Goals Made
    fga: int  # Field Goals Attempted
    fg_percentage: float  # Field Goal Percentage
    ftm: int  # Free Throws Made
    fta: int  # Free Throws Attempted
    ft_percentage: float  # Free Throw Percentage
    gp: int  # Games Played

class RankingStats(BaseModel):
    team: Team
    fg_percentage: float
    ft_percentage: float
    three_pm: float
    ast: float
    reb: float
    stl: float
    blk: float
    pts: float
    gp: int
    total_points: float
    rank: Optional[int] = None

class TeamShotStats(BaseModel):
    team: Team
    fgm: int  # Field Goals Made
    fga: int  # Field Goals Attempted
    fg_percentage: float  # Field Goal Percentage
    ftm: int  # Free Throws Made
    fta: int  # Free Throws Attempted
    ft_percentage: float  # Free Throw Percentage
    gp: int  # Games Played