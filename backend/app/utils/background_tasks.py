import asyncio
import logging
from typing import Any, Coroutine

from app.utils.request_context import trigger_var, upstream_var

logger = logging.getLogger(__name__)

# The event loop only keeps a weak reference to a task, so a fire-and-forget
# asyncio.create_task() whose result nobody holds can be garbage-collected
# mid-flight (see the asyncio.create_task docs). Every background task lives
# here until it finishes.
_tasks: set[asyncio.Task] = set()


def _on_done(task: asyncio.Task) -> None:
    _tasks.discard(task)
    if task.cancelled():
        return
    exc = task.exception()
    if exc is not None:
        logger.error(
            f"Background task {task.get_name()!r} crashed: {type(exc).__name__}: {exc}",
            exc_info=exc,
        )


async def _tagged(coro: Coroutine[Any, Any, Any], name: str) -> Any:
    # Runs in the task's own context copy: a task spawned by a request keeps
    # its request id and reads "GET /api/x > job:name".
    parent = trigger_var.get()
    trigger_var.set(f"job:{name}" if parent == "startup" else f"{parent} > job:{name}")
    upstream_var.set(None)
    return await coro


def spawn(coro: Coroutine[Any, Any, Any], *, name: str) -> asyncio.Task:
    """Start a fire-and-forget task that can't be garbage-collected before it
    finishes and whose crash is logged instead of silently swallowed."""
    task = asyncio.create_task(_tagged(coro, name), name=name)
    _tasks.add(task)
    task.add_done_callback(_on_done)
    return task


async def cancel_all() -> None:
    """Cancel every still-running background task and wait for them to unwind
    (app shutdown)."""
    pending = list(_tasks)
    for task in pending:
        task.cancel()
    await asyncio.gather(*pending, return_exceptions=True)
    _tasks.difference_update(pending)
