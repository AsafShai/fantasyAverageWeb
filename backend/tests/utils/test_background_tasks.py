import asyncio
import gc
import logging
import weakref

import pytest

from app.utils import background_tasks


@pytest.fixture(autouse=True)
def _clean_registry():
    background_tasks._tasks.clear()
    yield
    background_tasks._tasks.clear()


async def _wait_forever_on_orphan_future():
    # Nothing but this coroutine's frame references the future, so once the
    # task is unreferenced the whole cycle is garbage.
    await asyncio.get_running_loop().create_future()


@pytest.mark.asyncio
async def test_plain_create_task_can_be_garbage_collected_mid_flight():
    """Why the helper exists: the loop keeps only a weak reference to tasks."""
    ref = weakref.ref(asyncio.create_task(_wait_forever_on_orphan_future()))
    await asyncio.sleep(0)
    gc.collect()
    assert ref() is None


@pytest.mark.asyncio
async def test_spawned_task_survives_garbage_collection():
    ref = weakref.ref(background_tasks.spawn(_wait_forever_on_orphan_future(), name="orphan"))
    await asyncio.sleep(0)
    gc.collect()
    task = ref()
    assert task is not None and not task.done()
    task.cancel()
    await asyncio.sleep(0)


@pytest.mark.asyncio
async def test_registry_releases_task_when_it_finishes():
    async def quick():
        return 42

    task = background_tasks.spawn(quick(), name="quick")
    assert task in background_tasks._tasks
    assert await task == 42
    await asyncio.sleep(0)
    assert task not in background_tasks._tasks


@pytest.mark.asyncio
async def test_crash_is_logged_with_task_name(caplog):
    async def boom():
        raise RuntimeError("kaboom")

    with caplog.at_level(logging.ERROR, logger=background_tasks.__name__):
        task = background_tasks.spawn(boom(), name="estimator-scheduler")
        await asyncio.gather(task, return_exceptions=True)
        await asyncio.sleep(0)

    [record] = [r for r in caplog.records if r.levelno == logging.ERROR]
    assert "estimator-scheduler" in record.getMessage()
    assert "kaboom" in record.getMessage()
    assert record.exc_info is not None


@pytest.mark.asyncio
async def test_cancellation_is_not_logged_as_error(caplog):
    with caplog.at_level(logging.ERROR, logger=background_tasks.__name__):
        task = background_tasks.spawn(_wait_forever_on_orphan_future(), name="cancelled")
        await asyncio.sleep(0)
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
        await asyncio.sleep(0)

    assert not [r for r in caplog.records if r.levelno >= logging.ERROR]


@pytest.mark.asyncio
async def test_cancel_all_stops_every_pending_task():
    tasks = [background_tasks.spawn(_wait_forever_on_orphan_future(), name=f"t{i}") for i in range(3)]
    await asyncio.sleep(0)

    await background_tasks.cancel_all()

    assert all(t.cancelled() for t in tasks)
    assert not background_tasks._tasks
