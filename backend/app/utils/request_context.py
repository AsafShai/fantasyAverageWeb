import logging
import os
import uuid
from collections import Counter
from contextvars import ContextVar
from urllib.parse import urlsplit

# Correlates every log line emitted while serving one request (routes,
# services, background tasks spawned from it) with that request's access line.
# Background tasks inherit both vars via asyncio's context copy.
request_id_var: ContextVar[str] = ContextVar("request_id", default="-")

# What on our side caused the line: "GET /api/matchups/today" for a request,
# "job:injury-scheduler" for a scheduler, "startup" before the app serves.
trigger_var: ContextVar[str] = ContextVar("trigger", default="startup")

REQUEST_ID_HEADER = "X-Request-ID"
_MAX_INCOMING_ID_LEN = 64


def new_request_id(incoming: str | None = None) -> str:
    """Reuse a caller/proxy-supplied id so logs line up across hops; otherwise
    mint a short one."""
    if incoming and len(incoming) <= _MAX_INCOMING_ID_LEN and incoming.isprintable():
        return incoming
    return uuid.uuid4().hex[:8]


class UpstreamCalls:
    """Per-request tally of outbound HTTP calls, filled from httpx's own log
    records so every client is covered without wiring hooks into each one."""

    def __init__(self) -> None:
        self.by_host: Counter[str] = Counter()
        self.failures: list[str] = []

    def summary(self) -> str:
        if not self.by_host:
            return ""
        hosts = ", ".join(f"{host} x{n}" for host, n in self.by_host.most_common())
        failed = f" failed: {', '.join(self.failures[:5])}" if self.failures else ""
        return f"upstream[{hosts}]{failed}"


upstream_var: ContextVar[UpstreamCalls | None] = ContextVar("upstream", default=None)


def start_job_run(name: str) -> str:
    """Tag the current task's log lines as one run of a scheduled job. Its
    outbound calls are tallied silently: the job logs its own outcome (e.g.
    the injury poll's expected 403-then-200 retries are not warnings)."""
    run_id = uuid.uuid4().hex[:8]
    request_id_var.set(run_id)
    trigger_var.set(f"job:{name}")
    upstream_var.set(UpstreamCalls())
    return run_id

_HOST_ALIASES = {
    "lm-api-reads.fantasy.espn.com": "espn-fantasy",
    "site.api.espn.com": "espn-site",
    "site.web.api.espn.com": "espn-site",
    "sports.core.api.espn.com": "espn-core",
    "ak-static.cms.nba.com": "nba-injury-pdf",
    "stats.nba.com": "nba-stats",
    "cdn.nba.com": "nba-cdn",
}


def _short_host(url: str) -> str:
    host = urlsplit(url).hostname or "?"
    return _HOST_ALIASES.get(host, host)


class HttpxTallyFilter(logging.Filter):
    """Folds httpx's per-call INFO line into the request's upstream tally and
    drops it; the request's access line then reports the calls in one place.
    Non-2xx/3xx responses outside a request still log at WARNING."""

    def filter(self, record: logging.LogRecord) -> bool:
        args = record.args if isinstance(record.args, tuple) else ()
        if not record.getMessage().startswith("HTTP Request:") or len(args) < 4:
            return True
        _method, url, _version, status = args[:4]
        host = _short_host(str(url))
        failed = isinstance(status, int) and status >= 400
        calls = upstream_var.get()
        if calls is not None:
            calls.by_host[host] += 1
            if failed:
                calls.failures.append(f"{host} {status}")
            return False
        if not failed:
            return False
        record.levelno = logging.WARNING
        record.levelname = "WARNING"
        return True


class ContextFilter(logging.Filter):
    """Stamps request_id, trigger and a short logger name on every record."""

    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = request_id_var.get()
        record.trigger = trigger_var.get()
        name = record.name
        record.short_name = name.rsplit(".", 1)[-1] if name.startswith("app.") else name
        return True


def log_format() -> str:
    # Render stamps each line itself; a second timestamp only widens the line.
    stamp = "" if os.environ.get("RENDER") else "%(asctime)s "
    return stamp + "%(levelname)-7s [%(request_id)s %(trigger)s] %(short_name)s: %(message)s"


class DropDuplicateAsgiTraceback(logging.Filter):
    """uvicorn re-logs every unhandled exception the app already logged with
    its traceback (timing middleware / global handler), doubling ~60 lines."""

    def filter(self, record: logging.LogRecord) -> bool:
        return record.getMessage() != "Exception in ASGI application"
