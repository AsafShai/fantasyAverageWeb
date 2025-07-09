from fastapi import APIRouter, HTTPException
from app.models.fantasy import TeamDetail, LeagueSummary, HeatmapData, LeagueShotsData
from app.services.data_processor import DataProcessor
from typing import Annotated
from fastapi import Depends

router = APIRouter()

DataProcessorDep = Annotated[DataProcessor, Depends(DataProcessor)]

@router.get("/teams/{team_name}", response_model=TeamDetail)
async def get_team_stats(
    team_name: str,
    data_processor: DataProcessorDep
):
    """Get detailed stats for a specific team"""
    try:
        return data_processor.get_team_detail(team_name)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

@router.get("/league/summary", response_model=LeagueSummary)
async def get_league_summary(
    data_processor: DataProcessorDep
):
    """Get league overview and summary statistics"""
    return data_processor.get_league_summary()

@router.get("/charts/heatmap", response_model=HeatmapData)
async def get_heatmap_data(
    data_processor: DataProcessorDep
):
    """Get data for heatmap visualization"""
    return data_processor.get_heatmap_data()

@router.get("/league/shots", response_model=LeagueShotsData)
async def get_league_shots(
    data_processor: DataProcessorDep
):
    """Get league-wide shooting statistics"""
    return data_processor.get_league_shots_data()

@router.get("/totals")
async def get_totals_data(
    data_processor: DataProcessorDep
):
    """Get totals and processed ESPN data for debugging"""
    result = data_processor.get_totals_data()
    
    if not result:
        raise HTTPException(status_code=503, detail="No data available - ESPN API may be unavailable")
        
    return result