import hashlib

from starlette.datastructures import Headers, MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

# Endpoints whose data changes at most a few times a day. Every 200 gets a weak
# ETag of its body, so a browser revalidating after max-age gets an empty 304
# instead of the full payload. A route that sets its own Cache-Control keeps it.
CACHE_RULES: dict[str, str] = {
    # rebuilt at most daily (24h server cache)
    "/api/nba/schedule": "public, max-age=3600, stale-while-revalidate=86400",
    # draft picks are fixed after draft night
    "/api/league/draft-report": "public, max-age=300, stale-while-revalidate=3600",
    # same policy the ADP routes already set themselves
    "/api/adp": "public, max-age=60, stale-while-revalidate=600",
    "/api/adp/": "public, max-age=60, stale-while-revalidate=600",
    "/api/adp/index": "public, max-age=60, stale-while-revalidate=600",
    # recomputed once a day (09:00-11:00 IL); body carries elapsed_ms, so it
    # rarely revalidates to 304, but max-age still spares repeat fetches
    "/api/estimator/results": "public, max-age=300",
}


def weak_etag(body: bytes) -> str:
    return f'W/"{hashlib.sha1(body).hexdigest()[:16]}"'


def _matches(if_none_match: str, etag: str) -> bool:
    candidates = [part.strip() for part in if_none_match.split(",")]
    return "*" in candidates or etag in candidates


class HttpCacheMiddleware:
    """ETag + Cache-Control for the GET paths in `rules`, with 304 on a matching
    If-None-Match. Must sit inside GZipMiddleware so it hashes the uncompressed
    body (gzip output embeds a timestamp). Only buffers the listed paths."""

    def __init__(self, app: ASGIApp, rules: dict[str, str] | None = None) -> None:
        self.app = app
        self.rules = CACHE_RULES if rules is None else rules

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope["method"] != "GET" or scope["path"] not in self.rules:
            await self.app(scope, receive, send)
            return

        cache_control = self.rules[scope["path"]]
        if_none_match = Headers(scope=scope).get("if-none-match")
        start: Message | None = None
        chunks: list[bytes] = []

        async def buffered_send(message: Message) -> None:
            nonlocal start
            if message["type"] == "http.response.start":
                start = message
                return
            if message["type"] != "http.response.body" or start is None:
                await send(message)
                return
            chunks.append(message.get("body", b""))
            if message.get("more_body", False):
                return
            body = b"".join(chunks)
            headers = MutableHeaders(scope=start)
            if start["status"] != 200:
                await send(start)
                await send({"type": "http.response.body", "body": body})
                return
            etag = weak_etag(body)
            headers["ETag"] = etag
            if "cache-control" not in headers:
                headers["Cache-Control"] = cache_control
            if if_none_match and _matches(if_none_match, etag):
                not_modified = MutableHeaders(headers={
                    k: v for k, v in headers.items()
                    if k.lower() not in ("content-length", "content-type")
                })
                await send({"type": "http.response.start", "status": 304, "headers": not_modified.raw})
                await send({"type": "http.response.body", "body": b""})
                return
            await send(start)
            await send({"type": "http.response.body", "body": body})

        await self.app(scope, receive, buffered_send)
