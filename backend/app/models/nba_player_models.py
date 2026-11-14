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


class PlayerGameLogGame(BaseModel):
    game_id: str
    season: str
    game_date: date
    opponent: str
    is_home: bool
    team_pts: Optional[int] = None
    opp_pts: Optional[int] = None
    minutes: float
    pts: float
    reb: float
    ast: float
    stl: float
    blk: float
    tov: float
    fg3m: float
    fg3a: float
    fgm: float
    fga: float
    ftm: float
    fta: float
    plus_minus: float


class PlayerGameLogResponse(BaseModel):
    player_id: int
    current_season: str
    games: list[PlayerGameLogGame]


class PlayerSeasonLine(BaseModel):
    """One completed regular season, per-game averages (from ESPN)."""
    season: int
    season_label: str
    teams: list[str] = []
    gp: int = 0
    gs: int = 0
    minutes: Optional[float] = None
    fgm: Optional[float] = None
    fga: Optional[float] = None
    fg_percentage: Optional[float] = None
    ftm: Optional[float] = None
    fta: Optional[float] = None
    ft_percentage: Optional[float] = None
    three_pm: Optional[float] = None
    three_pa: Optional[float] = None
    reb: Optional[float] = None
    ast: Optional[float] = None
    stl: Optional[float] = None
    blk: Optional[float] = None
    to: Optional[float] = None
    pts: Optional[float] = None


class PlayerSeasonHistoryResponse(BaseModel):
    player_id: int
    seasons: list[PlayerSeasonLine]
