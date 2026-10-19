from typing import Literal, Optional

from pydantic import BaseModel

AccuracyMode = Literal['pregame', 'retro']
AccuracyWindow = Literal['week', 'd30', 'season']
ProjectionFlag = Literal['up', 'down', 'flat']


class CategoryAccuracy(BaseModel):
    key: str
    label: str
    band: float
    model_mae: Optional[float] = None
    baseline_mae: Optional[float] = None
    hit_rate: Optional[float] = None
    games: int


class AccuracySummary(BaseModel):
    mode: AccuracyMode
    window: AccuracyWindow
    start: Optional[str] = None
    end: Optional[str] = None
    games: int
    dnp: int
    categories: list[CategoryAccuracy]
    minutes: Optional[CategoryAccuracy] = None
    first_snapshot_date: Optional[str] = None


class WeekCategory(BaseModel):
    model_mae: Optional[float] = None
    baseline_mae: Optional[float] = None


class AccuracyWeek(BaseModel):
    week_start: str
    games: int
    categories: dict[str, WeekCategory]


class AccuracyWeekly(BaseModel):
    mode: AccuracyMode
    weeks: list[AccuracyWeek]


class MissStat(BaseModel):
    stat: str
    proj: float
    actual: float


class ProjectionMiss(BaseModel):
    player_id: int
    player_name: str
    game_date: str
    team_id: int
    team: str
    opponent_team_id: int
    opponent: str
    is_home: bool
    z: float
    line: list[MissStat]
    reason: str
    reason_detail: str


class DidNotPlay(BaseModel):
    player_id: int
    player_name: str
    game_date: str
    team: str
    opponent: str
    is_home: bool
    proj_min: float
    injury_status: Optional[str] = None


class AccuracyMisses(BaseModel):
    week_start: Optional[str] = None
    misses: list[ProjectionMiss]
    didnt_play: list[DidNotPlay] = []
    didnt_play_count: int = 0


class ProjectedGame(BaseModel):
    game_date: str
    opponent_team_id: int
    opponent: str
    z: float
    proj_pts: float
    actual_pts: float
    proj_min: float
    actual_min: float


class PlayerAccuracyRow(BaseModel):
    player_id: int
    player_name: str
    team_id: int
    team: str
    games: list[ProjectedGame]
    dnp: int
    proj_pts: float
    actual_pts: float
    proj_min: float
    actual_min: float
    flag: ProjectionFlag


class AccuracyPlayers(BaseModel):
    players: list[PlayerAccuracyRow]


class PlayerCategoryAccuracy(BaseModel):
    key: str
    label: str
    proj: float
    actual: Optional[float] = None


class PlayerAccuracy(BaseModel):
    player_id: int
    player_name: str
    games: list[ProjectedGame]
    categories: list[PlayerCategoryAccuracy]
    proj_min: float
    actual_min: float
    beat_count: int
    flag: ProjectionFlag
