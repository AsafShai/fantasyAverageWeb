import os
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.exception_handlers import http_exception_handler, request_validation_exception_handler
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from starlette.exceptions import HTTPException as StarletteHTTPException

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
from app.routes.box_scores import router as box_scores_router
from app.routes.adp import router as adp_router
from app.routes.surprises import router as surprises_router
from dotenv import load_dotenv
from app.config import settings
import logging
from app.services.data_provider import DataProvider
from app.services.nba_stats_service import NBAStatsService
from app.services.nba_matchup_service import get_shared_matchup_service
from app.services.league_activity_service import get_league_activity_service
from app.services.live_projection_service import LiveProjectionService
from app.services import schedule_service
from app.services import injury_service
from app.services import estimator_scheduler
from app.services import model_nightly_scheduler
from app.services import nba_players_scheduler
from app.services import adp_snapshot_scheduler
from app.services import health_service
from app.utils.timing_middleware import add_timing_middleware
from app.utils.request_context import ContextFilter, DropDuplicateAsgiTraceback, HttpxTallyFilter, log_format
from app.utils.http_cache import HttpCacheMiddleware
from app.utils import background_tasks
from app.utils.memory import log_memory
from app.exceptions import ResourceNotFoundError, DataSourceError

# Each line reads "LEVEL [request_id trigger] module: message" -- trigger is
# the endpoint or scheduled job on our side that caused it.
_log_handler = logging.StreamHandler()
_log_handler.addFilter(ContextFilter())
logging.basicConfig(
    level=getattr(logging, settings.log_level.upper()),
    format=log_format(),
    handlers=[_log_handler]
)
logging.getLogger("httpx").addFilter(HttpxTallyFilter())
logging.getLogger("uvicorn.error").addFilter(DropDuplicateAsgiTraceback())
logger = logging.getLogger(__name__)

limiter = Limiter(key_func=get_remote_address)

async def derive_season_start():
    """First regular-season game date: one fantasy request, falling back to the
    ~16-call scoreboard binary search."""
    derived_start = await schedule_service.get_season_start_date()
    if derived_start is not None:
        logger.info(f"Derived regular-season start from ESPN pro-team schedules: {derived_start}")
        return derived_start
    derived_start = await NBAStatsService().get_regular_season_start_date(settings.season_id)
    if derived_start is not None:
        logger.info(f"Derived regular-season start from NBA schedule: {derived_start}")
    return derived_start


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage application lifespan for proper resource cleanup"""
    # Startup
    logger.info(
        f"Starting Fantasy League Dashboard API: commit={os.environ.get('RENDER_GIT_COMMIT', 'local')[:7]} "
        f"season={settings.season_id} league={settings.league_id}"
    )
    logger.info(
        "Flags: "
        f"INJURY_SCHEDULER_ENABLED={settings.injury_scheduler_enabled}, "
        f"MODEL_NIGHTLY_ENABLED={settings.model_nightly_enabled}, "
        f"MODEL_FEATURE_HEAL_AUTO={settings.model_feature_heal_auto}, "
        f"NBA_PLAYERS_REFRESH_ENABLED={settings.nba_players_refresh_enabled}, "
        f"ADP_SCHEDULER_ENABLED={settings.adp_scheduler_enabled}, "
        f"LEAGUE_ACTIVITY_WARM={settings.league_activity_warm}, "
        f"ENVIRONMENT={settings.environment}, LOG_LEVEL={settings.log_level}"
    )
    log_memory("startup")
    try:
        derived_start = await derive_season_start()
        if derived_start is not None:
            logger.info(f"Regular-season start: {derived_start} (was {settings.season_start})")
            settings.season_start = derived_start
        else:
            logger.warning(f"Could not derive regular-season start; keeping configured SEASON_START={settings.season_start}")
    except Exception as e:
        logger.warning(f"Failed to derive regular-season start, keeping configured SEASON_START={settings.season_start}: {type(e).__name__}: {e}")
    try:
        derived_end = await schedule_service.get_season_end_date()
        if derived_end is not None:
            logger.info(f"Regular-season end: {derived_end} (was {settings.season_end})")
            settings.season_end = derived_end
        else:
            logger.warning(f"Could not derive regular-season end; keeping configured SEASON_END={settings.season_end}")
    except Exception as e:
        logger.warning(f"Failed to derive regular-season end, keeping configured SEASON_END={settings.season_end}: {type(e).__name__}: {e}")
    await injury_service.initialize()
    if settings.injury_scheduler_enabled:
        background_tasks.spawn(injury_service.start_scheduler(), name="injury-scheduler")
    else:
        logger.info("Injury scheduler disabled via INJURY_SCHEDULER_ENABLED=false")
    background_tasks.spawn(estimator_scheduler.start_scheduler(), name="estimator-scheduler")
    if settings.model_nightly_enabled:
        background_tasks.spawn(model_nightly_scheduler.start_scheduler(), name="model-nightly-scheduler")
    else:
        logger.info("Model nightly scheduler disabled via MODEL_NIGHTLY_ENABLED=false")
    if settings.nba_players_refresh_enabled:
        background_tasks.spawn(nba_players_scheduler.start_scheduler(), name="nba-players-scheduler")
    else:
        logger.info("NBA players refresh scheduler disabled via NBA_PLAYERS_REFRESH_ENABLED=false")
    if settings.adp_scheduler_enabled:
        background_tasks.spawn(adp_snapshot_scheduler.start_scheduler(), name="adp-snapshot-scheduler")
    else:
        logger.info("ADP snapshot scheduler disabled via ADP_SCHEDULER_ENABLED=false")
    if settings.league_activity_warm:
        background_tasks.spawn(get_league_activity_service().warm(), name="league-activity-warm")
    # After startup rather than at import, so the server is healthy sooner.
    background_tasks.spawn(LiveProjectionService().warm(), name="projection-model-warm")
    yield
    # Shutdown
    await background_tasks.cancel_all()
    try:
        data_provider = DataProvider()
        await data_provider.close()
        await NBAStatsService().close()
        await get_shared_matchup_service().close()
        await get_league_activity_service().close()
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

# The handlers below stash the error on request.state; the timing middleware
# appends it to the request's access-log line, so a 4xx/5xx says why without
# a second log line per error.
@app.exception_handler(StarletteHTTPException)
async def http_exception_logging_handler(request: Request, exc: StarletteHTTPException):
    request.state.error_detail = exc.detail
    return await http_exception_handler(request, exc)

@app.exception_handler(RequestValidationError)
async def validation_exception_logging_handler(request: Request, exc: RequestValidationError):
    request.state.error_detail = "; ".join(
        f"{'.'.join(str(p) for p in err.get('loc', ()))}: {err.get('msg')}" for err in exc.errors()
    )
    return await request_validation_exception_handler(request, exc)

@app.exception_handler(ResourceNotFoundError)
async def resource_not_found_handler(request: Request, exc: ResourceNotFoundError):
    request.state.error_detail = str(exc)
    return JSONResponse(status_code=404, content={"detail": str(exc)})

@app.exception_handler(DataSourceError)
async def data_source_error_handler(request: Request, exc: DataSourceError):
    request.state.error_detail = f"data source unavailable: {exc}"
    return JSONResponse(status_code=503, content={"detail": str(exc)})

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    if not getattr(request.state, "exception_logged", False):
        logger.error(f"Unhandled exception in {request.url}: {type(exc).__name__}: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={
            "detail": "Internal server error",
            "message": "An unexpected error occurred. Please try again later."
        }
    )

# Innermost (added first): must see the uncompressed body, see HttpCacheMiddleware.
app.add_middleware(HttpCacheMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in settings.cors_origins_list],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Level 6 instead of Starlette's default 9: measured at 0.15 CPU, cached
# /nba/schedule went 183 -> 72 ms for ~9% bigger payloads.
app.add_middleware(GZipMiddleware, minimum_size=1000, compresslevel=6)

add_timing_middleware(app)

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
app.include_router(box_scores_router, prefix='/api/nba', tags=['NBA Box Scores'])
app.include_router(adp_router, prefix='/api/adp', tags=['ADP'])
app.include_router(surprises_router, prefix='/api/surprises', tags=['Surprises'])



@app.get("/")
@limiter.limit("20/minute")
async def root(request: Request):
    return {"message": "Fantasy League Dashboard API"}

@app.get("/health")
@limiter.limit("60/minute")
async def health_check(request: Request, verbose: int = 0):
    return await health_service.collect(verbose=bool(verbose))

load_dotenv()

if __name__ == "__main__":
    import uvicorn
    logger.info(f"Starting Fantasy League Dashboard API on port {settings.port}")
    # uvicorn's own access log is off: the timing middleware logs every request
    # with its duration, request id and error detail instead.
    uvicorn.run(app, host="0.0.0.0", port=settings.port, proxy_headers=True, forwarded_allow_ips="*", access_log=False)
