import asyncio
import logging
import time

import httpx

from app.utils.constants import PRO_TEAM_MAP
from app.utils.name_matching import normalize_player_name
from app.utils.ssl_context import shared_ssl_context

logger = logging.getLogger(__name__)

_ABBREV_TO_TEAM_ID = {v: k for k, v in PRO_TEAM_MAP.items() if k != 0}
_DEPTHCHART_URL = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/{team_id}/depthcharts"
_CONCURRENCY = 30
_DEPTH_CHART_TTL_S = 7200


class DepthChartFetchError(Exception):
    def __init__(self, team_id: int, is_network_error: bool):
        self.team_id = team_id
        self.is_network_error = is_network_error
        super().__init__(f"Depth chart fetch failed for team {team_id}")


class DepthChartService:
    """Fetches and caches ESPN depth charts for pro teams. Shared by the
    matchups slate (get_on_depth_chart_names, fail-open per team) and the
    depth-chart page (get_depth_chart_raw, raises so the route can map to an
    HTTP status). Singleton so both callers hit the same 2h cache."""

    _instance = None
    _initialized = False

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def __init__(self) -> None:
        if not DepthChartService._initialized:
            self._client = httpx.AsyncClient(timeout=15.0, verify=shared_ssl_context())
            self._cache: dict[int, tuple[float, dict]] = {}
            DepthChartService._initialized = True

    async def get_on_depth_chart_names(self, pro_teams: set[str]) -> dict[str, set[str]]:
        semaphore = asyncio.Semaphore(_CONCURRENCY)
        team_ids = {abbrev: _ABBREV_TO_TEAM_ID[abbrev] for abbrev in pro_teams if abbrev in _ABBREV_TO_TEAM_ID}

        async def fetch_one(abbrev: str, team_id: int) -> tuple[str, set[str]]:
            async with semaphore:
                try:
                    data = await self.get_depth_chart_raw(team_id)
                except Exception as e:
                    logger.error(f"Depth chart fetch/parse failed for team {team_id}: {type(e).__name__}: {e}")
                    return abbrev, set()
                return abbrev, self._extract_names(data)

        results = await asyncio.gather(*(fetch_one(abbrev, tid) for abbrev, tid in team_ids.items()))
        return dict(results)

    async def get_depth_chart_raw(self, team_id: int) -> dict:
        cached = self._cache.get(team_id)
        if cached is not None and time.monotonic() - cached[0] < _DEPTH_CHART_TTL_S:
            return cached[1]

        try:
            resp = await self._client.get(_DEPTHCHART_URL.format(team_id=team_id))
        except httpx.HTTPError as e:
            logger.error(f"ESPN depth chart fetch failed for team {team_id}: {type(e).__name__}: {e}")
            raise DepthChartFetchError(team_id, is_network_error=True) from e

        if resp.status_code != 200:
            logger.error(f"Depth chart fetch for team {team_id} returned HTTP {resp.status_code}")
            raise DepthChartFetchError(team_id, is_network_error=False)

        data = resp.json()
        self._cache[team_id] = (time.monotonic(), data)
        return data

    @staticmethod
    def _extract_names(data: dict) -> set[str]:
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
