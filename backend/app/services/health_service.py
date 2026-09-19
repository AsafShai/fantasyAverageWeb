import logging
import re
import time
from datetime import datetime
from typing import Any, Callable

from app.services import estimator_scheduler, injury_service, model_nightly_scheduler
from app.services.cache_manager import CacheManager
from app.services.db_service import DBService
from app.services.estimator_service import EstimatorService
from app.services.model_nightly_service import ModelNightlyService
from app.utils.timing_middleware import slow_requests_last_hour

logger = logging.getLogger(__name__)

_STARTED_AT = time.monotonic()
_PLAYERS_CACHE_RE = re.compile(r"players_(\d+)")


def _age_seconds(stamp: datetime | None) -> int | None:
    if stamp is None:
        return None
    return int((datetime.now() - stamp).total_seconds())


async def _safe(name: str, fn: Callable) -> Any:
    try:
        return await fn()
    except Exception as e:
        logger.warning(f"health: {name} collector failed: {type(e).__name__}: {e}")
        return {"ok": False, "error": type(e).__name__}


async def _collect_db() -> dict:
    pool = await DBService()._get_pool()
    if pool is None:
        return {"ok": False, "error": "no_pool"}
    started = time.perf_counter()
    async with pool.acquire() as conn:
        await conn.fetchval("SELECT 1")
    return {"ok": True, "ping_ms": round((time.perf_counter() - started) * 1000, 1)}


async def _collect_espn() -> dict:
    cache = CacheManager()
    players_age: dict[str, int | None] = {}
    for attr in dir(cache):
        match = _PLAYERS_CACHE_RE.fullmatch(attr)
        if not match:
            continue
        entry = getattr(cache, attr)
        if isinstance(entry, dict):
            players_age[match.group(1)] = _age_seconds(entry.get("timestamp"))
    return {
        "ok": True,
        "totals_age_s": _age_seconds(cache.totals_cache.get("fetched_at")),
        "players_age_s": players_age,
        "totals_etag": cache.totals_cache.get("etag"),
        "data_date": str(cache.totals_cache["data_date"]) if cache.totals_cache.get("data_date") else None,
    }


async def _collect_injury() -> dict:
    return {
        "ok": True,
        "last_report": injury_service.last_report_time,
        "players": len(injury_service.injury_store),
        "sse_clients": len(injury_service.sse_subscribers),
    }


async def _collect_nightly() -> dict:
    run = await DBService().get_latest_model_nightly_run()
    return {
        "ok": True,
        "last_date": str(run["game_date"]) if run else None,
        "status": run.get("status") if run else None,
        "rows": run.get("num_rows") if run else None,
        "store_loaded": ModelNightlyService()._inference_store is not None,
    }


async def _collect_estimator() -> dict:
    cache_date = EstimatorService()._cache_date
    return {"ok": True, "as_of_date": str(cache_date) if cache_date else None}


async def _collect_schedulers() -> dict:
    return {
        "ok": True,
        "injury_next": injury_service.compute_next_trigger().isoformat(),
        "nightly_next": model_nightly_scheduler._compute_next_trigger().isoformat(),
        "estimator_next": estimator_scheduler._compute_next_trigger().isoformat(),
    }


async def collect(verbose: bool) -> dict:
    base = {
        "status": "healthy",
        "timestamp": datetime.now().isoformat(),
        "service": "Fantasy League Dashboard API",
    }
    if not verbose:
        return base

    base["uptime_s"] = int(time.monotonic() - _STARTED_AT)
    base["db"] = await _safe("db", _collect_db)
    base["espn"] = await _safe("espn", _collect_espn)
    base["injury"] = await _safe("injury", _collect_injury)
    base["nightly"] = await _safe("nightly", _collect_nightly)
    base["estimator"] = await _safe("estimator", _collect_estimator)
    base["schedulers"] = await _safe("schedulers", _collect_schedulers)
    base["slow_requests_1h"] = slow_requests_last_hour()
    return base
