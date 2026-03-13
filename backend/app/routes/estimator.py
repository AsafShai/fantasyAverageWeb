import logging
import time
from fastapi import APIRouter, HTTPException
from app.models.estimator import EstimatorResults, TeamPrediction, TeamRanking, TeamRankProbability
from app.services.estimator_service import EstimatorService

router = APIRouter()
logger = logging.getLogger(__name__)


def _build_results(data: dict, elapsed_ms: float) -> EstimatorResults:
    predictions = [TeamPrediction(**r) for r in data.get("predictions", [])]
    as_of_date = predictions[0].as_of_date.isoformat() if predictions else ""
    return EstimatorResults(
        as_of_date=as_of_date,
        elapsed_ms=elapsed_ms,
        predictions=predictions,
        rankings=[TeamRanking(**r) for r in data.get("rankings", [])],
        rank_probabilities=[TeamRankProbability(**r) for r in data.get("rank_probabilities", [])],
    )


@router.get("/results", response_model=EstimatorResults)
async def get_estimator_results():
    start = time.perf_counter()
    try:
        service = EstimatorService()

        data = await service.get_latest()
        if data is None:
            ran = await service.run_and_store()
            if ran:
                data = await service.get_latest()

        elapsed_ms = (time.perf_counter() - start) * 1000
        logger.info(f"Estimator endpoint completed in {elapsed_ms:.1f}ms")

        if not data or not data.get("rankings"):
            raise HTTPException(
                status_code=404,
                detail="No estimator data available yet. The estimator runs daily after NBA games are completed."
            )

        return _build_results(data, elapsed_ms)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting estimator results: {e}")
        raise HTTPException(status_code=500, detail="Failed to retrieve estimator results")
