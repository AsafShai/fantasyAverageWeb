import re
import logging

import httpx
from fastapi import APIRouter, HTTPException

from app.models.nba_team_models import DepthChartPlayer, DepthChartPosition, InjuryInfo, NbaTeamInfo, TeamDepthChart
from app.services.db_service import get_db_service
from app.utils.constants import PRO_TEAM_MAP, NBA_TEAM_NAMES

router = APIRouter()
logger = logging.getLogger(__name__)

_NORMALIZE_RE = re.compile(r"[^a-z0-9]")


def _normalize_name(name: str) -> str:
    return _NORMALIZE_RE.sub("", name.lower())


@router.get("/", response_model=list[NbaTeamInfo])
async def list_nba_teams():
    return [NbaTeamInfo(team_id=str(k), abbreviation=v, team_name=NBA_TEAM_NAMES[v]) for k, v in PRO_TEAM_MAP.items() if k != 0]


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

    db_service = get_db_service()
    all_statuses = await db_service.load_all_injury_statuses()
    injury_lookup = {_normalize_name(row['player']): row['status'] for row in all_statuses}

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
