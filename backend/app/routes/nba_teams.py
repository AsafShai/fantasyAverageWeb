import re
import logging

import httpx
from fastapi import APIRouter, HTTPException

from app.models.nba_team_models import DepthChartPlayer, DepthChartPosition, InjuryInfo, NbaTeamInfo, TeamDepthChart
from app.services import injury_service

router = APIRouter()
logger = logging.getLogger(__name__)

NBA_TEAMS: list[dict] = [
    {"team_id": "1",  "team_name": "Atlanta Hawks",          "abbreviation": "ATL"},
    {"team_id": "2",  "team_name": "Boston Celtics",         "abbreviation": "BOS"},
    {"team_id": "3",  "team_name": "New Orleans Pelicans",   "abbreviation": "NOP"},
    {"team_id": "4",  "team_name": "Chicago Bulls",          "abbreviation": "CHI"},
    {"team_id": "5",  "team_name": "Cleveland Cavaliers",    "abbreviation": "CLE"},
    {"team_id": "6",  "team_name": "Dallas Mavericks",       "abbreviation": "DAL"},
    {"team_id": "7",  "team_name": "Denver Nuggets",         "abbreviation": "DEN"},
    {"team_id": "8",  "team_name": "Detroit Pistons",        "abbreviation": "DET"},
    {"team_id": "9",  "team_name": "Golden State Warriors",  "abbreviation": "GSW"},
    {"team_id": "10", "team_name": "Houston Rockets",        "abbreviation": "HOU"},
    {"team_id": "11", "team_name": "Indiana Pacers",         "abbreviation": "IND"},
    {"team_id": "12", "team_name": "LA Clippers",            "abbreviation": "LAC"},
    {"team_id": "13", "team_name": "Los Angeles Lakers",     "abbreviation": "LAL"},
    {"team_id": "14", "team_name": "Miami Heat",             "abbreviation": "MIA"},
    {"team_id": "15", "team_name": "Milwaukee Bucks",        "abbreviation": "MIL"},
    {"team_id": "16", "team_name": "Minnesota Timberwolves", "abbreviation": "MIN"},
    {"team_id": "17", "team_name": "Brooklyn Nets",          "abbreviation": "BKN"},
    {"team_id": "18", "team_name": "New York Knicks",        "abbreviation": "NYK"},
    {"team_id": "19", "team_name": "Orlando Magic",          "abbreviation": "ORL"},
    {"team_id": "20", "team_name": "Philadelphia 76ers",     "abbreviation": "PHI"},
    {"team_id": "21", "team_name": "Phoenix Suns",           "abbreviation": "PHX"},
    {"team_id": "22", "team_name": "Portland Trail Blazers", "abbreviation": "POR"},
    {"team_id": "23", "team_name": "Sacramento Kings",       "abbreviation": "SAC"},
    {"team_id": "24", "team_name": "San Antonio Spurs",      "abbreviation": "SAS"},
    {"team_id": "25", "team_name": "Oklahoma City Thunder",  "abbreviation": "OKC"},
    {"team_id": "26", "team_name": "Utah Jazz",              "abbreviation": "UTA"},
    {"team_id": "27", "team_name": "Memphis Grizzlies",      "abbreviation": "MEM"},
    {"team_id": "28", "team_name": "Toronto Raptors",        "abbreviation": "TOR"},
    {"team_id": "29", "team_name": "Charlotte Hornets",      "abbreviation": "CHA"},
    {"team_id": "30", "team_name": "Washington Wizards",     "abbreviation": "WAS"},
]

_NORMALIZE_RE = re.compile(r"[^a-z0-9]")


def _normalize_name(name: str) -> str:
    return _NORMALIZE_RE.sub("", name.lower())


def _build_injury_lookup() -> dict[str, str]:
    lookup: dict[str, str] = {}
    for record in injury_service.injury_store.values():
        lookup[_normalize_name(record.player)] = record.status
    return lookup


@router.get("/", response_model=list[NbaTeamInfo])
async def list_nba_teams():
    return [NbaTeamInfo(**t) for t in NBA_TEAMS]


@router.get("/{team_id}/depthchart", response_model=TeamDepthChart)
async def get_depth_chart(team_id: int):
    url = f"https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/{team_id}/depthcharts"
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(url)
    except httpx.HTTPError as e:
        logger.error(f"ESPN depth chart fetch failed for team {team_id}: {e}")
        raise HTTPException(status_code=502, detail="Failed to fetch depth chart from ESPN")

    if resp.status_code != 200:
        raise HTTPException(status_code=404, detail=f"Team {team_id} not found on ESPN")

    data = resp.json()
    team_data = data.get("team", {})
    depthcharts = data.get("depthchart", [])

    injury_lookup = _build_injury_lookup()

    positions: list[DepthChartPosition] = []
    if depthcharts:
        pos_map = depthcharts[0].get("positions", {})
        for pos_key, pos_val in pos_map.items():
            pos_info = pos_val.get("position", {})
            athletes = pos_val.get("athletes", [])

            players: list[DepthChartPlayer] = []
            seen_ids: set[str] = set()
            for athlete in athletes:
                athlete_id = athlete.get("id", "")
                if athlete_id in seen_ids:
                    continue
                seen_ids.add(athlete_id)

                display_name = athlete.get("displayName", "")
                normalized = _normalize_name(display_name)
                injury_status = injury_lookup.get(normalized)

                players.append(DepthChartPlayer(
                    id=athlete_id,
                    display_name=display_name,
                    short_name=athlete.get("shortName", ""),
                    injury=InjuryInfo(status=injury_status) if injury_status else None,
                ))

            positions.append(DepthChartPosition(
                abbreviation=pos_info.get("abbreviation", pos_key.upper()),
                display_name=pos_info.get("displayName", pos_key.upper()),
                players=players,
            ))

    return TeamDepthChart(
        team_id=str(team_data.get("id", team_id)),
        team_name=team_data.get("displayName", ""),
        team_abbreviation=team_data.get("abbreviation", ""),
        team_logo=team_data.get("logo", ""),
        record=team_data.get("recordSummary", ""),
        positions=positions,
    )
