"""Record/replay every outgoing HTTP request the backend makes (httpx only).

The golden harness runs the app twice (pandas "before", Polars "after") on the
same inputs. Every ESPN / NBA / ADP request goes through httpx, so patching the
two httpx transports is enough to pin all external data:

  * record: requests go out for real; the first response for each request key
    is stored (gzip, one file per key). Later identical requests are answered
    from the tape too, so a recording run already sees the same data a replay
    will.
  * replay: requests are answered from the tape only. A request with no
    recording raises httpx.ConnectError (what the app sees when ESPN is down)
    and is logged as a miss, so a before/after diff in *which* requests were
    made shows up in the outputs.

The key is method + URL (query params sorted) + request body + ESPN's
X-Fantasy-Filter header. Other headers are ignored (ETag revalidation always
gets the stored 200).
"""

from __future__ import annotations

import gzip
import hashlib
import json
import threading
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import httpx

_DROP_HEADERS = {"content-encoding", "transfer-encoding", "content-length", "connection"}


def _norm_url(url: httpx.URL) -> str:
    parts = urlsplit(str(url))
    query = urlencode(sorted(parse_qsl(parts.query, keep_blank_values=True)))
    return urlunsplit((parts.scheme, parts.netloc, parts.path, query, ""))


def request_key(request: httpx.Request) -> tuple[str, str]:
    body = request.content or b""
    url = _norm_url(request.url)
    raw = f"{request.method} {url} {hashlib.sha1(body).hexdigest()}"
    label = f"{request.method} {url}"
    # ESPN's fantasy API selects the data (stat split, player filter, page)
    # with this header, so it is part of what was asked for.
    ff = request.headers.get("x-fantasy-filter")
    if ff:
        raw += f" ff={ff}"
        label += f" [x-fantasy-filter {hashlib.sha1(ff.encode()).hexdigest()[:8]}]"
    return hashlib.sha1(raw.encode()).hexdigest(), label


class Tape:
    def __init__(self, root: Path, mode: str):
        assert mode in ("record", "replay")
        self.root = Path(root)
        self.mode = mode
        self.root.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self.misses: list[str] = []
        self.requests: list[str] = []
        self._orig_async = None
        self._orig_sync = None

    # -- storage -----------------------------------------------------------
    def _path(self, key: str) -> Path:
        return self.root / key[:2] / f"{key}.json.gz"

    def _load(self, key: str) -> dict | None:
        p = self._path(key)
        if not p.exists():
            return None
        with gzip.open(p, "rt", encoding="utf-8") as fh:
            return json.load(fh)

    def _store(self, key: str, label: str, entry: dict) -> None:
        p = self._path(key)
        if p.exists():
            return
        p.parent.mkdir(parents=True, exist_ok=True)
        entry = {"label": label, **entry}
        tmp = p.with_suffix(".tmp")
        with gzip.open(tmp, "wt", encoding="utf-8", compresslevel=6) as fh:
            json.dump(entry, fh)
        tmp.replace(p)

    @staticmethod
    def _to_response(entry: dict, request: httpx.Request) -> httpx.Response:
        if "error" in entry:
            cls = getattr(httpx, entry["error"], httpx.ConnectError)
            raise cls(entry.get("message", "recorded error"), request=request)
        content = bytes.fromhex(entry["body_hex"]) if "body_hex" in entry else entry["body"].encode("utf-8")
        return httpx.Response(
            entry["status"], headers=entry["headers"], content=content, request=request
        )

    @staticmethod
    def _entry(response: httpx.Response, content: bytes) -> dict:
        headers = [(k, v) for k, v in response.headers.items() if k.lower() not in _DROP_HEADERS]
        entry = {"status": response.status_code, "headers": headers}
        try:
            entry["body"] = content.decode("utf-8")
        except UnicodeDecodeError:
            entry["body_hex"] = content.hex()
        return entry

    def _miss(self, label: str, request: httpx.Request):
        with self._lock:
            self.misses.append(label)
        raise httpx.ConnectError(f"golden tape miss: {label}", request=request)

    # -- transport patches -------------------------------------------------
    def install(self) -> None:
        tape = self
        self._orig_async = httpx.AsyncHTTPTransport.handle_async_request
        self._orig_sync = httpx.HTTPTransport.handle_request
        orig_async, orig_sync = self._orig_async, self._orig_sync

        async def handle_async_request(transport, request):
            key, label = request_key(request)
            with tape._lock:
                tape.requests.append(label)
            entry = tape._load(key)
            if entry is not None:
                return tape._to_response(entry, request)
            if tape.mode == "replay":
                tape._miss(label, request)
            try:
                response = await orig_async(transport, request)
                content = await response.aread()
            except httpx.HTTPError as e:
                tape._store(key, label, {"error": type(e).__name__, "message": str(e)})
                raise
            tape._store(key, label, tape._entry(response, content))
            return tape._to_response(tape._load(key), request)

        def handle_request(transport, request):
            key, label = request_key(request)
            with tape._lock:
                tape.requests.append(label)
            entry = tape._load(key)
            if entry is not None:
                return tape._to_response(entry, request)
            if tape.mode == "replay":
                tape._miss(label, request)
            try:
                response = orig_sync(transport, request)
                content = response.read()
            except httpx.HTTPError as e:
                tape._store(key, label, {"error": type(e).__name__, "message": str(e)})
                raise
            tape._store(key, label, tape._entry(response, content))
            return tape._to_response(tape._load(key), request)

        httpx.AsyncHTTPTransport.handle_async_request = handle_async_request
        httpx.HTTPTransport.handle_request = handle_request

    def uninstall(self) -> None:
        if self._orig_async is not None:
            httpx.AsyncHTTPTransport.handle_async_request = self._orig_async
            httpx.HTTPTransport.handle_request = self._orig_sync
