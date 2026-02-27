from pydantic import BaseModel
from typing import List
from enum import Enum

class StatTimePeriod(str, Enum):
    SEASON = "season"
    LAST_7 = "last_7"
    LAST_15 = "last_15"
    LAST_30 = "last_30"

    @classmethod
    def to_stat_split_id(cls, period: 'StatTimePeriod') -> int:
        mapping = {
            cls.SEASON: 0,
            cls.LAST_7: 1,
            cls.LAST_15: 2,
            cls.LAST_30: 3
        }
        return mapping[period]

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
    status: str

class PaginatedPlayers(BaseModel):
    players: List[Player]
    total_count: int
    page: int
    limit: int
    has_more: bool
