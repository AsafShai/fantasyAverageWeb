from pydantic import BaseModel
from typing import List

class PlayerStats(BaseModel):
    pts: float
    reb: float
    ast: float
    stl: float
    blk: float
    fgm: float
    fga: float
    ftm: float
    fta: float
    fg_percentage: float
    ft_percentage: float
    three_pm: float
    minutes: float
    gp: int

class Player(BaseModel):
    player_name: str
    pro_team: str
    positions: List[str]
    stats: PlayerStats
    team_id: int
