from datetime import date
from typing import Optional

from pydantic import BaseModel, ConfigDict

from app.models.player import PlayerStats


class NbaPlayerBio(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    display_name: str
    team: str
    team_abbr: str
    conference: str
    division: str
    position: str
    photo_url: Optional[str] = None
    height: Optional[str] = None
    nationality: Optional[str] = None
    age: Optional[int] = None
    jersey_number: Optional[str] = None


class NbaPlayerStatsResponse(BaseModel):
    player_id: int
    totals: PlayerStats
    averages: PlayerStats
    has_data: bool = True
    actual_start: Optional[date] = None
    actual_end: Optional[date] = None
