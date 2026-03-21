from pydantic import BaseModel


class InjuryInfo(BaseModel):
    status: str


class DepthChartPlayer(BaseModel):
    id: str
    display_name: str
    short_name: str
    injury: InjuryInfo | None = None


class DepthChartPosition(BaseModel):
    abbreviation: str
    display_name: str
    players: list[DepthChartPlayer]


class TeamDepthChart(BaseModel):
    team_id: str
    team_name: str
    team_abbreviation: str
    team_logo: str
    record: str
    positions: list[DepthChartPosition]


class NbaTeamInfo(BaseModel):
    team_id: str
    abbreviation: str
