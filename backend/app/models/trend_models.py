from typing import Literal, Optional

from pydantic import BaseModel


RegressionMode = Literal['season', 'form']


class RegressionStatItem(BaseModel):
    """Field meanings shift with the request's mode — the shape is shared so one
    table can render both. mode=season: current_pct is season-to-date, baseline_pct
    is prior seasons only, attempts_per_game is season volume, drift_score is the
    volume-weighted drift. mode=form: current_pct is the window only, baseline_pct
    excludes the window, attempts_per_game is window volume, drift_score is |z|."""
    stat: Literal['3P%', 'FT%', 'FG%']
    current_pct: float
    baseline_pct: float
    dev: float
    attempts_per_game: float
    drift_score: float
    window_pct: Optional[float] = None  # None when the window holds no attempts
    window_attempts: int = 0  # sample behind window_pct — small means treat it loosely
    z: Optional[float] = None  # two-proportion z of dev; mode=form only


class RegressionPlayerGroup(BaseModel):
    player_id: int
    player_name: str
    pro_team: str
    position: str
    fantasy_status: str  # owning team name, or 'FA'
    games_last_15d: int
    stats: list[RegressionStatItem]


class RegressionResponse(BaseModel):
    items: list[RegressionPlayerGroup]
    window_days: int
    baseline_seasons: int
    mode: RegressionMode
    last_updated: str


class MinutesMoverItem(BaseModel):
    player_id: int
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
    player_id: int
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


class GameLogEntry(BaseModel):
    game_date: str
    matchup: str
    min: float
    usg: float
    fgm: int
    fga: int
    ftm: int
    fta: int
    fg3m: int
    fg3a: int


class GameLogResponse(BaseModel):
    player_id: int
    player_name: str
    season: str
    window_days: int
    window_start: str
    season_gp: int
    season_mpg: float
    season_usg: float
    season_pct: dict[str, float]  # '3P%' | 'FT%' | 'FG%' -> season-to-date pct
    baseline_pct: dict[str, float]  # same keys -> prior-season baseline pct
    league_pct: dict[str, float]  # same keys -> league-wide pct this season
    league_usg: Optional[float] = None  # minutes-weighted league USG%, ~20 by construction
    baseline_seasons: int
    games: list[GameLogEntry]
