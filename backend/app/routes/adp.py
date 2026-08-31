import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, Response

from app.models.adp import AdpIndexResponse, AdpResponse, ProviderMeta
from app.services.adp_service import (
    get_adp_index_response,
    get_adp_response_enriched,
    refresh_adp_sources,
)

router = APIRouter()
logger = logging.getLogger(__name__)

# Short browser/CDN reuse; the process cache (30 min) is still the source of truth.
_ADP_CACHE_CONTROL = "public, max-age=60, stale-while-revalidate=600"


def _cache_headers(response: Response) -> None:
    response.headers["Cache-Control"] = _ADP_CACHE_CONTROL


def _positions(pos: Optional[str]) -> Optional[list[str]]:
    if not pos:
        return None
    return [part.strip() for part in pos.split(",") if part.strip()]


def _ids(ids: Optional[str]) -> Optional[list[str]]:
    if not ids:
        return None
    return [part.strip() for part in ids.split(",") if part.strip()]


@router.get("/index", response_model=AdpIndexResponse)
async def get_adp_index(
    response: Response,
    ranked_only: bool = Query(True),
    sites: Optional[str] = Query(None),
    rank_sites: Optional[str] = Query(None),
    metric: str = Query("adp"),
    include_fringe: bool = Query(False),
):
    _cache_headers(response)
    try:
        return await get_adp_index_response(
            ranked_only=ranked_only,
            sites=sites,
            rank_sites=rank_sites,
            metric=metric,
            include_fringe=include_fringe,
        )
    except Exception as e:
        logger.error("Error building ADP index: %s", e)
        raise HTTPException(status_code=500, detail="Failed to retrieve ADP data")


@router.post("/refresh", response_model=list[ProviderMeta])
async def refresh_adp(provider: Optional[str] = Query(None)):
    """Re-fetch one provider (or all of them) now, ignoring the 24h TTL."""
    try:
        return await refresh_adp_sources(provider)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error("Error refreshing ADP sources: %s", e)
        raise HTTPException(status_code=500, detail="Failed to refresh ADP data")


@router.get("", response_model=AdpResponse)
@router.get("/", response_model=AdpResponse)
async def get_adp(
    response: Response,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=2000),
    sort: str = Query("blend"),
    sort_dir: str = Query("asc"),
    q: Optional[str] = Query(None),
    team: Optional[str] = Query(None),
    pos: Optional[str] = Query(None),
    ids: Optional[str] = Query(None),
    ranked_only: bool = Query(True),
    sites: Optional[str] = Query(None),
    rank_sites: Optional[str] = Query(None),
    metric: str = Query("adp"),
    include_fringe: bool = Query(False),
    include_stats: bool = Query(True),
):
    _cache_headers(response)
    try:
        return await get_adp_response_enriched(
            page=page,
            page_size=page_size,
            sort=sort,
            sort_dir=sort_dir,
            q=q or "",
            team=team or "",
            positions=_positions(pos),
            ranked_only=ranked_only,
            ids=_ids(ids),
            sites=sites,
            rank_sites=rank_sites,
            metric=metric,
            include_fringe=include_fringe,
            include_stats=include_stats,
        )
    except Exception as e:
        logger.error("Error building ADP response: %s", e)
        raise HTTPException(status_code=500, detail="Failed to retrieve ADP data")
