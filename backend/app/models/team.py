from pydantic import BaseModel
from typing import ClassVar, List, Dict, Optional
from datetime import datetime, date
from .base import Team
from .stats import ShotChartStats, TeamAverageStats, RankingStats, SlotUsage
from .player import Player, TeamRosterPlayer
from .live import LiveAware

class TeamTonight(BaseModel):
    """What tonight changed for this team, against this morning's official
    standings. Sent only while the live overlay is applied."""
    # Games played added to the averages tonight (finished games only).
    gp: int = 0
    # Change in roto total points (averages view) tonight.
    points: float = 0
    # Games added per slot tonight, games in progress included ("+N live").
    slots: Dict[str, int] = {}
    # Starters checked in to a game that is not final yet.
    starters_live: int = 0


class TeamDetail(LiveAware):
    omit_when_none: ClassVar[tuple[str, ...]] = ('live', 'tonight')
    team: Team
    espn_url: str
    players: Optional[List[TeamRosterPlayer]] = None
    shot_chart: ShotChartStats
    raw_averages: TeamAverageStats
    ranking_stats: RankingStats
    category_ranks: Dict[str, int]
    slot_usage: Dict[str, SlotUsage]
    data_date: Optional[date] = None
    actual_start: Optional[date] = None
    actual_end: Optional[date] = None
    tonight: Optional[TeamTonight] = None

class TeamPlayers(BaseModel):
    team_id: int
    players: List[Player]
    last_updated: datetime