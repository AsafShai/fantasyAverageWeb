"""Bounding for the ``{key: (expires_at, value)}`` dicts several services cache in.

Those dicts drop an expired entry only when the same key is read again, so a key
nobody asks for twice (an old game, a night someone browsed once) stays for the
life of the process. Measured on real ESPN payloads: every night of box scores
browsed pinned ~3.4 MB that was never reused. ``store`` sweeps expired entries on
every write and caps the count, so the cache holds what is live and recent.
"""

import time
from typing import Any, Hashable, MutableMapping, Optional


def prune(cache: MutableMapping[Hashable, tuple], max_entries: int, now: Optional[float] = None) -> None:
    """Drop expired entries (``value[0]`` is a ``time.monotonic()`` deadline), then the
    oldest-written ones until at most ``max_entries`` remain."""
    now = time.monotonic() if now is None else now
    for key in [k for k, v in cache.items() if v[0] <= now]:
        del cache[key]
    while len(cache) > max_entries:
        del cache[next(iter(cache))]


def store(cache: MutableMapping[Hashable, tuple], key: Hashable, expires_at: float, value: Any, max_entries: int) -> None:
    """Write ``key`` as the newest entry, keeping the cache within ``max_entries``."""
    cache.pop(key, None)  # a rewrite counts as recent: move it to the end
    prune(cache, max_entries - 1)
    cache[key] = (expires_at, value)
