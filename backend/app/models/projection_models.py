from typing import Literal, Optional

from pydantic import BaseModel

ProjectionStatus = Literal['green', 'amber', 'red']


class ProjectionStats(BaseModel):
    pts: float
    reb: float
    ast: float
    three_pm: float
    stl: float
    blk: float
    fgm: float
    fga: float
    fg_pct: float
    ftm: float
    fta: float
    ft_pct: float


class Projection(BaseModel):
    default_minutes: float
    status: ProjectionStatus
    reason: str = ''
    stats: Optional[ProjectionStats] = None


class PredictProjectionRequest(BaseModel):
    player_name: str
    opponent: str  # ESPN abbreviation
    is_home: bool
    minutes: float


class PredictProjectionResponse(BaseModel):
    stats: ProjectionStats
