from pydantic import BaseModel
from typing import Dict, Optional
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
    # Generic per-category values for this league's actual scoring categories,
    # keyed by category code (e.g. "PTS", "TO"). Superset of the fixed fields
    # above for leagues that score categories beyond the historical default 8;
    # the fixed fields above stay populated as before for backward compatibility.
    stats: Optional[Dict[str, float]] = None

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
    category_ranks: Optional[Dict[str, int]] = None
    # See AverageStats.stats
    stats: Optional[Dict[str, float]] = None

class TeamShotStats(BaseModel):
    team: Team
    fgm: int  # Field Goals Made
    fga: int  # Field Goals Attempted
    fg_percentage: float  # Field Goal Percentage
    ftm: int  # Free Throws Made
    fta: int  # Free Throws Attempted
    ft_percentage: float  # Free Throw Percentage
    gp: int  # Games Played