from fastapi import APIRouter, Query, HTTPException
from typing import Optional
from app.models.fantasy import LeagueRankings
from app.services.data_processor import DataProcessor
from typing import Annotated
from fastapi import Depends

router = APIRouter()

DataProcessorDep = Annotated[DataProcessor, Depends(DataProcessor)]

@router.get("/rankings", response_model=LeagueRankings)
async def get_rankings(
    data_processor: DataProcessorDep,
    sort_by: Optional[str] = Query(None, description="Category to sort by"),
    order: Optional[str] = Query("desc", description="Sort order: asc or desc")
):
    """Get league rankings with optional sorting"""
    if order not in ["asc", "desc"]:
        raise HTTPException(status_code=400, detail="Order must be 'asc' or 'desc'")
    return data_processor.get_rankings(sort_by=sort_by, order=order)

@router.get("/rankings/category/{category}")
async def get_category_rankings(
    category: str,
    data_processor: DataProcessorDep
):
    """Get rankings for a specific category"""
    result = data_processor.get_category_rankings(category)
    if not result:
        raise HTTPException(status_code=404, detail=f"Category '{category}' not found or no data available")
    return result