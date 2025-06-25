from fastapi import APIRouter, Query
from typing import Optional
from app.models.fantasy import LeagueRankings
from app.services.data_processor import DataProcessor

router = APIRouter()
data_processor = DataProcessor()

@router.get("/rankings", response_model=LeagueRankings)
async def get_rankings(
    sort_by: Optional[str] = Query(None, description="Category to sort by"),
    order: Optional[str] = Query("desc", description="Sort order: asc or desc")
):
    """Get league rankings with optional sorting"""
    return data_processor.get_rankings(sort_by=sort_by, order=order)

@router.get("/rankings/category/{category}")
async def get_category_rankings(category: str):
    """Get rankings for a specific category"""
    return data_processor.get_category_rankings(category)