from typing import Optional

from pydantic import BaseModel


class PlayerStoreSummary(BaseModel):
    player_id: int
    player_name: str
    team_abbr: str
    games_count: int
    eligible: bool


class PlayersListResponse(BaseModel):
    players: list[PlayerStoreSummary]


class PlayerStoreState(BaseModel):
    player_id: int
    player_name: str
    team_abbr: str
    position: str
    last_game_date: Optional[str]
    games_count: int
    eligible: bool
    features: dict[str, Optional[float]]


class TeamSummary(BaseModel):
    team_id: int
    team_abbr: str


class TeamsListResponse(BaseModel):
    teams: list[TeamSummary]


class TeamStoreState(BaseModel):
    team_id: int
    team_abbr: str
    own: dict[str, Optional[float]]
    allowed: dict[str, Optional[float]]
