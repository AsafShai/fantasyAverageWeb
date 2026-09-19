import ssl
from typing import Optional

import httpx

_ssl_context: Optional[ssl.SSLContext] = None


def shared_ssl_context() -> ssl.SSLContext:
    """Lazily-built SSLContext shared by every non-HTTP/2 httpx client.

    httpx.AsyncClient(verify=True) rebuilds this from certifi's CA bundle on
    every construction (~600ms blocking CPU); reusing one context avoids that.
    Safe to share only among clients that agree on ALPN (httpcore calls
    set_alpn_protocols on whatever context it's given) — do not hand this to
    an http2=True client.
    """
    global _ssl_context
    if _ssl_context is None:
        _ssl_context = httpx.create_ssl_context()
    return _ssl_context
