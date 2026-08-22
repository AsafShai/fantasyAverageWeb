from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class SiteAdp(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    adp: Optional[float] = None
    rank: Optional[int] = None


class LastYearStats(BaseModel):
    """Per-game averages from the prior NBA season. Percentages are 0–1."""

    model_config = ConfigDict(populate_by_name=True)

    gp: int
    fg_pct: float
    ft_pct: float
    ppg: float
    rpg: float
    apg: float
    spg: float
    bpg: float
    three_pm: float


class AdpPlayer(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    espn_id: Optional[int] = None
    name: str
    team: Optional[str] = None
    team_abbr: Optional[str] = None
    photo_url: Optional[str] = None
    positions: list[str] = Field(default_factory=list)
    espn: SiteAdp = Field(default_factory=SiteAdp)
    fantrax: SiteAdp = Field(default_factory=SiteAdp)
    sleeper: SiteAdp = Field(default_factory=SiteAdp)
    blend: Optional[float] = None
    blend_rank: Optional[int] = None
    spread: Optional[float] = None
    last_year: Optional[LastYearStats] = None
    projection: Optional[LastYearStats] = None


class AdpIndexPlayer(BaseModel):
    """Lightweight row for the rankings board (no photos, site ADPs, or stats)."""

    model_config = ConfigDict(populate_by_name=True)

    id: str
    espn_id: Optional[int] = None
    name: str
    team_abbr: Optional[str] = None
    positions: list[str] = Field(default_factory=list)
    blend: Optional[float] = None
    blend_rank: Optional[int] = None


class AdpIndexResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    season_label: str
    updated_at: str
    teams: list[str] = Field(default_factory=list)
    players: list[AdpIndexPlayer] = Field(default_factory=list)
    total: int = 0


class AdpResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    season_label: str
    updated_at: str
    last_year_season: Optional[str] = None
    projection_season: Optional[str] = None
    sources: dict[str, str] = Field(default_factory=dict)
    players: list[AdpPlayer] = Field(default_factory=list)
    teams: list[str] = Field(default_factory=list)
    total: int = 0
    page: int = 1
    page_size: int = 50
    total_pages: int = 1
    offset: int = 0
