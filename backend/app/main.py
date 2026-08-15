import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

from app.routes.rankings import router as rankings_router
from app.routes.teams import router as teams_router
from app.routes.league import router as league_router
from app.routes.analytics import router as analytics_router
from app.routes.players import router as players_router
from app.routes.injuries import router as injuries_router
from app.routes.estimator import router as estimator_router
from app.routes.nba_teams import router as nba_teams_router
from app.routes.nba_players import router as nba_players_router
from app.routes.minigames import router as minigames_router
from app.routes.matchups import router as matchups_router
from app.routes.projections import router as projections_router
from app.routes.feature_store import router as feature_store_router
from app.routes.trends import router as trends_router
from app.routes.schedule import router as schedule_router
from dotenv import load_dotenv
from app.config import settings
import logging
from datetime import datetime
from app.services.data_provider import DataProvider
from app.services.nba_stats_service import NBAStatsService
from app.services import injury_service
from app.services import estimator_scheduler
from app.services import model_nightly_scheduler
from app.exceptions import ResourceNotFoundError, DataSourceError

# Configure logging
logging.basicConfig(
    level=getattr(logging, settings.log_level.upper()),
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

limiter = Limiter(key_func=get_remote_address, default_limits=["100/minute"])

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage application lifespan for proper resource cleanup"""
    # Startup
    logger.info("Starting Fantasy League Dashboard API")
    try:
        derived_start = await NBAStatsService().get_regular_season_start_date(settings.season_id)
        if derived_start is not None:
            logger.info(f"Derived regular-season start from NBA schedule: {derived_start} (was {settings.season_start})")
            settings.season_start = derived_start
        else:
            logger.warning(f"Could not derive regular-season start; keeping configured SEASON_START={settings.season_start}")
    except Exception as e:
        logger.warning(f"Failed to derive regular-season start, keeping configured SEASON_START={settings.season_start}: {type(e).__name__}: {e}")
    await injury_service.initialize()
    if settings.injury_scheduler_enabled:
        asyncio.create_task(injury_service.start_scheduler())
    else:
        logger.info("Injury scheduler disabled via INJURY_SCHEDULER_ENABLED=false")
    asyncio.create_task(estimator_scheduler.start_scheduler())
    if settings.model_nightly_enabled:
        asyncio.create_task(model_nightly_scheduler.start_scheduler())
    else:
        logger.info("Model nightly scheduler disabled via MODEL_NIGHTLY_ENABLED=false")
    yield
    # Shutdown
    try:
        data_provider = DataProvider()
        await data_provider.close()
        await NBAStatsService().close()
        logger.info("Closed httpx client connections")
    except Exception as e:
        logger.error(f"Error during shutdown cleanup: {e}")

app = FastAPI(
    title="Fantasy League Dashboard API",
    version="1.0.0",
    lifespan=lifespan,
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

@app.exception_handler(ResourceNotFoundError)
async def resource_not_found_handler(request: Request, exc: ResourceNotFoundError):
    return JSONResponse(status_code=404, content={"detail": str(exc)})

@app.exception_handler(DataSourceError)
async def data_source_error_handler(request: Request, exc: DataSourceError):
    logger.warning(f"Data source unavailable for {request.url}: {exc}")
    return JSONResponse(status_code=503, content={"detail": str(exc)})

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error(f"Unhandled exception in {request.url}: {type(exc).__name__}: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={
            "detail": "Internal server error",
            "message": "An unexpected error occurred. Please try again later."
        }
    )

app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in settings.cors_origins_list],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.add_middleware(GZipMiddleware, minimum_size=1000)

app.include_router(rankings_router, prefix="/api", tags=["Rankings"])
app.include_router(teams_router, prefix="/api/teams", tags=["Teams"])
app.include_router(league_router, prefix="/api/league", tags=["League"])
app.include_router(analytics_router, prefix="/api/analytics", tags=["Analytics"])
app.include_router(players_router, prefix="/api/players", tags=["Players"])
app.include_router(injuries_router, prefix="/api/injuries", tags=["Injuries"])
app.include_router(estimator_router, prefix="/api/estimator", tags=["Estimator"])
app.include_router(nba_teams_router, prefix="/api/nba-teams", tags=["NBA Teams"])
app.include_router(nba_players_router, prefix="/api/nba-players", tags=["NBA Players"])
app.include_router(minigames_router, prefix="/api/minigames", tags=["Minigames"])
app.include_router(matchups_router, prefix='/api/matchups', tags=['Matchups'])
app.include_router(projections_router, prefix='/api/projections', tags=['Projections'])
app.include_router(feature_store_router, prefix='/api/feature-store', tags=['Feature Store'])
app.include_router(trends_router, prefix='/api/trends', tags=['Trends'])
app.include_router(schedule_router, prefix='/api/nba', tags=['NBA Schedule'])



@app.get("/")
@limiter.limit("20/minute")
async def root(request: Request):
    return {"message": "Fantasy League Dashboard API"}

@app.get("/health")
@limiter.limit("60/minute")
async def health_check(request: Request):
    return {
        "status": "healthy",
        "timestamp": datetime.now().isoformat(),
        "service": "Fantasy League Dashboard API"
    }

load_dotenv()

if __name__ == "__main__":
    import uvicorn
    logger.info(f"Starting Fantasy League Dashboard API on port {settings.port}")
    uvicorn.run(app, host="0.0.0.0", port=settings.port)
