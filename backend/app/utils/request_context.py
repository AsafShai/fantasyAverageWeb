import logging
import uuid
from contextvars import ContextVar

# Correlates every log line emitted while serving one request (routes,
# services, the httpx client's own "HTTP Request: ..." lines) with that
# request's access-log line. Background tasks spawned from a request inherit
# it via asyncio's context copy; schedulers and startup log "-".
request_id_var: ContextVar[str] = ContextVar("request_id", default="-")

REQUEST_ID_HEADER = "X-Request-ID"
_MAX_INCOMING_ID_LEN = 64


def new_request_id(incoming: str | None = None) -> str:
    """Reuse a caller/proxy-supplied id so logs line up across hops; otherwise
    mint a short one."""
    if incoming and len(incoming) <= _MAX_INCOMING_ID_LEN and incoming.isprintable():
        return incoming
    return uuid.uuid4().hex[:8]


class RequestIdFilter(logging.Filter):
    """Stamps record.request_id so the format string can reference it."""

    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = request_id_var.get()
        return True
