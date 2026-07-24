from typing import Optional

from pydantic import BaseModel

from app.models.projection_models import Projection


class DefRanks(BaseModel):
    pts: int
    reb: int
    ast: int
    stl: int
    blk: int
    three_pm: int
    fg_pct: int


class DefValues(BaseModel):
    pts: float
    reb: float
    ast: float
    stl: float
    blk: float
    three_pm: float
    fg_pct: float


class PlayerMatchupResponse(BaseModel):
    player_name: str
    pro_team: str
    opponent: str
    is_home: bool
    pace: float
    league_avg_pace: float
    positions: list[str]
    def_ranks: DefRanks
    def_values: DefValues
    league_avg_def_values: DefValues
    projection: Optional[Projection] = None
    game_date: Optional[str] = None  # ISO date this slate resolved to (None if unknown)
    on_depth_chart: bool = True
    injury_status: Optional[str] = None
