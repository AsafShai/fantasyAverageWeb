from fastapi import APIRouter
from app.models.fantasy import TeamDetail, LeagueSummary, HeatmapData
from app.services.data_processor import DataProcessor

router = APIRouter()
data_processor = DataProcessor()

@router.get("/teams/{team_name}", response_model=TeamDetail)
async def get_team_stats(team_name: str):
    """Get detailed stats for a specific team"""
    return data_processor.get_team_detail(team_name)

@router.get("/league/summary", response_model=LeagueSummary)
async def get_league_summary():
    """Get league overview and summary statistics"""
    return data_processor.get_league_summary()

@router.get("/charts/heatmap", response_model=HeatmapData)
async def get_heatmap_data():
    """Get data for heatmap visualization"""
    return data_processor.get_heatmap_data()

@router.get("/raw-data")
async def get_raw_data():
    """Get raw ESPN data for debugging"""
    try:
        data_processor.load_data_from_api()
        data_processor.process_data()
        
        # Convert to records format to avoid any index issues
        result = {}
        
        if data_processor.raw_df is not None:
            # Reset index to get Team as a column, then convert to records
            raw_copy = data_processor.raw_df.reset_index()
            result["raw_data"] = raw_copy.to_dict('records')
        
        if data_processor.averages_df is not None:
            avg_copy = data_processor.averages_df.reset_index()
            result["averages"] = avg_copy.to_dict('records')
            
        if data_processor.ranking_df is not None:
            # ranking_df should already have Team as a column
            result["rankings"] = data_processor.ranking_df.to_dict('records')
            
        return result
        
    except Exception as e:
        import traceback
        return {"error": str(e), "traceback": traceback.format_exc(), "message": "Failed to load data"}