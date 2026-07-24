import asyncio
import logging

import httpx

from app.utils.constants import PRO_TEAM_MAP
from app.utils.name_matching import normalize_player_name

logger = logging.getLogger(__name__)

_ABBREV_TO_TEAM_ID = {v: k for k, v in PRO_TEAM_MAP.items() if k != 0}
_DEPTHCHART_URL = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/{team_id}/depthcharts"
_CONCURRENCY = 30  # max possible distinct pro teams in one slate -- effectively one wave


class DepthChartService:
    """Fetches ESPN depth charts for a set of pro teams, in parallel, fail-open
    per team — a slate that includes an ESPN outage for one team should still
    render every other team's rows rather than losing the whole response."""

    async def get_on_depth_chart_names(self, pro_teams: set[str]) -> dict[str, set[str]]:
        semaphore = asyncio.Semaphore(_CONCURRENCY)
        team_ids = {abbrev: _ABBREV_TO_TEAM_ID[abbrev] for abbrev in pro_teams if abbrev in _ABBREV_TO_TEAM_ID}

        # Shared client so concurrent calls reuse one connection pool to
        # site.api.espn.com instead of each paying its own TCP+TLS handshake.
        async with httpx.AsyncClient(timeout=15.0) as client:
            async def fetch_one(abbrev: str, team_id: int) -> tuple[str, set[str]]:
                async with semaphore:
                    names = await self._fetch_depth_chart_names(client, team_id)
                    return abbrev, names

            results = await asyncio.gather(*(fetch_one(abbrev, tid) for abbrev, tid in team_ids.items()))
        return dict(results)

    async def _fetch_depth_chart_names(self, client: httpx.AsyncClient, team_id: int) -> set[str]:
        try:
            resp = await client.get(_DEPTHCHART_URL.format(team_id=team_id))
            if resp.status_code != 200:
                logger.error(f"Depth chart fetch for team {team_id} returned HTTP {resp.status_code}")
                return set()

            data = resp.json()
            depthcharts = data.get("depthchart", [])
            if not depthcharts:
                return set()

            names: set[str] = set()
            for pos_val in depthcharts[0].get("positions", {}).values():
                for athlete in pos_val.get("athletes", []):
                    display_name = athlete.get("displayName", "")
                    if display_name:
                        names.add(normalize_player_name(display_name))
            return names
        except Exception as e:
            logger.error(f"Depth chart fetch/parse failed for team {team_id}: {e}")
            return set()
