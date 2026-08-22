import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from app.models.adp import AdpIndexResponse, AdpResponse
from app.services.adp_service import get_adp_index_response, get_adp_response_enriched

router = APIRouter()
logger = logging.getLogger(__name__)


def _positions(pos: Optional[str]) -> Optional[list[str]]:
    if not pos:
        return None
    return [part.strip() for part in pos.split(",") if part.strip()]


def _ids(ids: Optional[str]) -> Optional[list[str]]:
    if not ids:
        return None
    return [part.strip() for part in ids.split(",") if part.strip()]


@router.get("/index", response_model=AdpIndexResponse)
async def get_adp_index(ranked_only: bool = Query(True)):
    try:
        return await get_adp_index_response(ranked_only=ranked_only)
    except Exception as e:
        logger.error("Error building ADP index: %s", e)
        raise HTTPException(status_code=500, detail="Failed to retrieve ADP data")


@router.get("", response_model=AdpResponse)
@router.get("/", response_model=AdpResponse)
async def get_adp(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=2000),
    sort: str = Query("blend"),
    sort_dir: str = Query("asc"),
    q: Optional[str] = Query(None),
    team: Optional[str] = Query(None),
    pos: Optional[str] = Query(None),
    board: int = Query(0, ge=0, le=12),
    ids: Optional[str] = Query(None),
    ranked_only: bool = Query(True),
    sites: Optional[str] = Query(None),
):
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
            board=board,
            ids=_ids(ids),
            sites=sites,
        )
    except Exception as e:
        logger.error("Error building ADP response: %s", e)
        raise HTTPException(status_code=500, detail="Failed to retrieve ADP data")
