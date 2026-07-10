from pydantic import BaseModel
from typing import List, Optional
from datetime import date, timedelta
from enum import Enum

class StatTimePeriod(str, Enum):
    SEASON = "season"
    LAST_7 = "last_7"
    LAST_15 = "last_15"
    LAST_30 = "last_30"
    CUSTOM = "custom"

    @classmethod
    def to_stat_split_id(cls, period: 'StatTimePeriod') -> int:
        mapping = {
            cls.SEASON: 0,
            cls.LAST_7: 1,
            cls.LAST_15: 2,
            cls.LAST_30: 3,
            cls.CUSTOM: 0,
        }
        return mapping[period]

    @classmethod
    def resolve_window(
        cls,
        period: 'StatTimePeriod',
        start: Optional[date],
        end: Optional[date],
        season_start: date,
        today: Optional[date] = None,
    ) -> tuple[date, date]:
        """(start, end) calendar-day window for the given period, inclusive.

        `today` should be the season's anchor date (latest date with real game
        data, falling back to real calendar today if the season hasn't
        started) — NOT necessarily real calendar today. Callers resolve that
        anchor themselves; this function only clamps around it so a window
        never extends past season_start or the anchor, regardless of which
        date got passed in.

        Callers that accept HTTP input (routes) must validate start/end
        themselves (both-or-neither, ordering, season bounds) before calling
        this — it assumes valid input and only resolves the window.
        """
        today = today or date.today()
        if period == cls.CUSTOM:
            if start is None or end is None:
                raise ValueError("custom time_period requires both start and end")
            return start, end
        if period == cls.SEASON:
            return season_start, today
        if period == cls.LAST_7:
            return max(today - timedelta(days=6), season_start), today
        if period == cls.LAST_15:
            return max(today - timedelta(days=14), season_start), today
        if period == cls.LAST_30:
            return max(today - timedelta(days=29), season_start), today
        raise ValueError(f"Unsupported time_period: {period}")

class PlayerStats(BaseModel):
    pts: float
    reb: float
    ast: float
    stl: float
    blk: float
    fgm: float
    fga: float
    ftm: float
    fta: float
    fg_percentage: float
    ft_percentage: float
    three_pm: float
    minutes: float
    gp: int

class Player(BaseModel):
    player_name: str
    pro_team: str
    positions: List[str]
    stats: PlayerStats
    team_id: int
    status: str
    injured: bool = False
    fantasy_team_name: Optional[str] = None
    season_rating: Optional[float] = None
    last7_rating: Optional[float] = None
    last15_rating: Optional[float] = None
    last30_rating: Optional[float] = None
    # False only for a custom-range player unmatched in fs_player_games (no ESPN
    # fallback exists for custom); stats is a zeroed placeholder in that case.
    has_data: bool = True

class PaginatedPlayers(BaseModel):
    players: List[Player]
    total_count: int
    page: int
    limit: int
    has_more: bool
    actual_start: Optional[date] = None
    actual_end: Optional[date] = None
