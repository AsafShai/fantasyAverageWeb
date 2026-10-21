"""Process/container memory readings for log lines.

An OOM kill leaves no traceback, so the only trail is the last line logged
before it. Heavy jobs call ``log_memory`` at each step so that line names the
step and how close the container was to its limit.
"""

import logging
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

# cgroup v2 first, then v1. Usage here is what the OOM killer compares to the
# limit (it includes page cache), so it can read higher than RSS.
_CGROUP_FILES = [
    ("/sys/fs/cgroup/memory.current", "/sys/fs/cgroup/memory.max"),
    ("/sys/fs/cgroup/memory/memory.usage_in_bytes", "/sys/fs/cgroup/memory/memory.limit_in_bytes"),
]
# v1 reports "no limit" as a huge number rather than "max".
_NO_LIMIT_THRESHOLD = 1 << 60
WARN_FRACTION = 0.8


def _read_int(path: str) -> Optional[int]:
    try:
        raw = Path(path).read_text().strip()
    except OSError:
        return None
    if raw == "max":
        return None
    try:
        return int(raw)
    except ValueError:
        return None


def _rss_bytes() -> Optional[int]:
    try:
        for line in Path("/proc/self/status").read_text().splitlines():
            if line.startswith("VmRSS:"):
                return int(line.split()[1]) * 1024
    except (OSError, ValueError, IndexError):
        pass
    return None


def memory_snapshot() -> dict[str, Optional[int]]:
    """RSS of this process plus container usage/limit when the cgroup exposes them."""
    usage = limit = None
    for usage_path, limit_path in _CGROUP_FILES:
        usage = _read_int(usage_path)
        if usage is not None:
            limit = _read_int(limit_path)
            if limit is not None and limit >= _NO_LIMIT_THRESHOLD:
                limit = None
            break
    return {"rss": _rss_bytes(), "usage": usage, "limit": limit}


def _mb(n: Optional[int]) -> str:
    return "?" if n is None else f"{n / (1024 * 1024):.0f}MB"


def log_memory(step: str, log: logging.Logger = logger) -> None:
    """Log one line with memory at ``step``; warning level near the limit."""
    snap = memory_snapshot()
    msg = f"[mem] {step}: rss={_mb(snap['rss'])}"
    level = logging.INFO
    if snap["usage"] is not None:
        msg += f" container={_mb(snap['usage'])}"
        if snap["limit"]:
            frac = snap["usage"] / snap["limit"]
            msg += f"/{_mb(snap['limit'])} ({frac:.0%})"
            if frac >= WARN_FRACTION:
                level = logging.WARNING
                msg += " — near memory limit"
    log.log(level, msg)
