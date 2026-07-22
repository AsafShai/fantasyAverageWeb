from typing import Literal, Optional

from pydantic import BaseModel


class RegressionStatItem(BaseModel):
    stat: Literal['3P%', 'FT%', 'FG%']
    current_pct: float
    baseline_pct: float
    dev: float
    attempts_per_game: float
    drift_score: float


class RegressionPlayerGroup(BaseModel):
    player_name: str
    pro_team: str
    position: str
    fantasy_status: str  # owning team name, or 'FA'
    games_last_15d: int
    stats: list[RegressionStatItem]


class RegressionResponse(BaseModel):
    items: list[RegressionPlayerGroup]
    window_days: int
    last_updated: str


class MinutesMoverItem(BaseModel):
    player_name: str
    pro_team: str
    position: str
    fantasy_status: str  # owning team name, or 'FA'
    games_last_15d: int
    season_mpg: float
    l5_mpg: float
    delta_mpg: float
    season_gp: int
    window_gp: int  # games in the last-5 window; can be < 5 for sparse history
    low_sample: bool  # window_gp < 5 — L5 average is a partial window


class MinutesResponse(BaseModel):
    items: list[MinutesMoverItem]
    window_days: int
    last_updated: str


class UsageRoleItem(BaseModel):
    player_name: str
    pro_team: str
    position: str
    fantasy_status: str  # owning team name, or 'FA'
    games_last_15d: int
    season_usg: float
    l5_usg: float
    delta_usg: float
    season_mpg: float
    l5_mpg: float
    delta_mpg: float
    season_gp: int
    window_gp: int
    role_badge: Optional[str] = None  # 'Role ↑' / 'Minutes ↑' / 'Usage ↑' / mirrored ↓, or None


class UsageResponse(BaseModel):
    items: list[UsageRoleItem]
    window_days: int
    last_updated: str
