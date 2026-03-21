from typing import Optional, Literal
from pydantic import BaseModel


class InjuryRecord(BaseModel):
    game: str
    team: str
    player: str
    status: str
    injury: str
    last_update: str
    game_time_utc: str | None = None


class InjuryNotification(BaseModel):
    type: Literal["status_change", "added", "removed"]
    player: str
    team: str
    old_status: Optional[str] = None
    new_status: Optional[str] = None
    timestamp: str
