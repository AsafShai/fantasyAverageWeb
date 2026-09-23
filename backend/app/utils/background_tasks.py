import asyncio
import logging
from typing import Any, Coroutine

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


def spawn(coro: Coroutine[Any, Any, Any], *, name: str) -> asyncio.Task:
    """Start a fire-and-forget task that can't be garbage-collected before it
    finishes and whose crash is logged instead of silently swallowed."""
    task = asyncio.create_task(coro, name=name)
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
