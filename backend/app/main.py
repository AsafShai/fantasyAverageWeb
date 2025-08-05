from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.routes.rankings import router as rankings_router
from app.routes.teams import router as teams_router
from app.routes.league import router as league_router
from app.routes.analytics import router as analytics_router
from app.routes.trades import router as trades_router, limiter
from dotenv import load_dotenv
from app.config import settings
import logging
from datetime import datetime
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

# Configure logging
logging.basicConfig(
    level=getattr(logging, settings.log_level.upper()),
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler('fantasy_api.log')
    ]
)
logger = logging.getLogger(__name__)

app = FastAPI(title="Fantasy League Dashboard API", version="1.0.0")

# Add rate limiter to app
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# Global exception handler for unhandled server errors
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error(f"Unhandled exception in {request.url}: {str(exc)}", exc_info=True)
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

app.include_router(rankings_router, prefix="/api", tags=["Rankings"])
app.include_router(teams_router, prefix="/api/teams", tags=["Teams"])
app.include_router(league_router, prefix="/api/league", tags=["League"])
app.include_router(analytics_router, prefix="/api/analytics", tags=["Analytics"])
app.include_router(trades_router, prefix="/api/trades", tags=["Trades"])

@app.get("/")
async def root():
    return {"message": "Fantasy League Dashboard API"}

@app.get("/health")
async def health_check():
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
