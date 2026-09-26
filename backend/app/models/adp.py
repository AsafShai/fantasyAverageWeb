from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class SiteAdp(BaseModel):
    """One provider's take on a player.

    `rank` is derived by us from `adp`; `ranking` is the provider's own published list.
    """

    model_config = ConfigDict(populate_by_name=True)

    adp: Optional[float] = None
    rank: Optional[int] = None
    ranking: Optional[int] = None


class ProviderMeta(BaseModel):
    """What a provider offers, so the frontend never hardcodes the capability matrix."""

    model_config = ConfigDict(populate_by_name=True)

    key: str
    label: str
    has_adp: bool = False
    has_rankings: bool = False
    fetched_at: Optional[str] = None
    source_url: Optional[str] = None
    player_count: int = 0
    stale: bool = False


class LastYearStats(BaseModel):
    """Per-game averages from the prior NBA season. Percentages are 0–1."""

    model_config = ConfigDict(populate_by_name=True)

    gp: int
    fg_pct: float
    ft_pct: float
    fgm: float = 0.0
    fga: float = 0.0
    ftm: float = 0.0
    fta: float = 0.0
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
    yahoo: SiteAdp = Field(default_factory=SiteAdp)
    blend: Optional[float] = None
    blend_rank: Optional[int] = None
    spread: Optional[float] = None
    ranking_blend: Optional[float] = None
    ranking_blend_rank: Optional[int] = None
    ranking_spread: Optional[float] = None
    # No NBA games last season, no current NBA team, and ranked only by the deepest source:
    # out of the league rather than merely undrafted. Excluded unless include_fringe is set.
    fringe: bool = False
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
    ranking_blend: Optional[float] = None
    ranking_blend_rank: Optional[int] = None
    fringe: bool = False


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
    providers: list[ProviderMeta] = Field(default_factory=list)
    players: list[AdpPlayer] = Field(default_factory=list)
    teams: list[str] = Field(default_factory=list)
    total: int = 0
    page: int = 1
    page_size: int = 50
    total_pages: int = 1
    offset: int = 0


class AdpMover(BaseModel):
    """One player's change between two snapshots. `delta` is positive when he moved up
    (a lower ADP or ranking), matching how risers are read."""

    model_config = ConfigDict(populate_by_name=True)

    id: str
    espn_id: Optional[int] = None
    name: str
    team_abbr: Optional[str] = None
    photo_url: Optional[str] = None
    positions: list[str] = Field(default_factory=list)
    from_value: Optional[float] = None
    to_value: Optional[float] = None
    delta: Optional[float] = None


class AdpMoversSection(BaseModel):
    """Movers for one site, or for the Blend of the selected sites (key "blend")."""

    model_config = ConfigDict(populate_by_name=True)

    key: str
    label: str
    from_date: Optional[str] = None
    to_date: Optional[str] = None
    compared: int = 0
    risers: list[AdpMover] = Field(default_factory=list)
    fallers: list[AdpMover] = Field(default_factory=list)
    entered: list[AdpMover] = Field(default_factory=list)
    exited: list[AdpMover] = Field(default_factory=list)
    note: Optional[str] = None


class AdpSnapshotHistory(BaseModel):
    """Which days a provider has stored data for, and on which of them the active
    metric actually changed (for rankings: the site's update dates)."""

    model_config = ConfigDict(populate_by_name=True)

    key: str
    label: str
    first_date: Optional[str] = None
    last_date: Optional[str] = None
    change_dates: list[str] = Field(default_factory=list)


class AdpMoversResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    metric: str
    mode: str
    from_date: Optional[str] = None
    to_date: Optional[str] = None
    top: Optional[int] = None
    sections: list[AdpMoversSection] = Field(default_factory=list)
    history: list[AdpSnapshotHistory] = Field(default_factory=list)


class AdpTrendResponse(BaseModel):
    """Blend change per player over the last `days`, for the ADP table's trend badges."""

    model_config = ConfigDict(populate_by_name=True)

    metric: str
    days: int
    from_date: Optional[str] = None
    to_date: Optional[str] = None
    deltas: dict[str, float] = Field(default_factory=dict)
