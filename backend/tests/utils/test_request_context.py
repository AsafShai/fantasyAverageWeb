import logging

import asyncio

import pytest

from app.utils import background_tasks
from app.utils.request_context import (
    ContextFilter,
    new_request_id,
    request_id_var,
    start_job_run,
    trigger_var,
)


def test_new_request_id_reuses_sane_incoming_value():
    assert new_request_id("abc-123") == "abc-123"


def test_new_request_id_mints_when_missing_or_unreasonable():
    assert len(new_request_id(None)) == 8
    assert len(new_request_id("x" * 500)) == 8
    assert len(new_request_id("bad\nid")) == 8


def test_filter_stamps_request_id_trigger_and_short_name():
    record = logging.LogRecord("app.services.injury_service", logging.INFO, __file__, 1, "msg", None, None)
    rid_token = request_id_var.set("rid-1")
    trigger_token = trigger_var.set("GET /api/teams/")
    try:
        assert ContextFilter().filter(record) is True
    finally:
        request_id_var.reset(rid_token)
        trigger_var.reset(trigger_token)
    assert (record.request_id, record.trigger, record.short_name) == ("rid-1", "GET /api/teams/", "injury_service")


@pytest.mark.asyncio
async def test_spawned_task_names_its_parent_request_as_trigger():
    seen = {}

    async def job():
        seen["trigger"] = trigger_var.get()
        seen["rid"] = request_id_var.get()

    async def in_request():
        request_id_var.set("rid-9")
        trigger_var.set("GET /api/matchups/today")
        await background_tasks.spawn(job(), name="matchups-rebuild")

    await asyncio.create_task(in_request())
    assert seen == {"trigger": "GET /api/matchups/today > job:matchups-rebuild", "rid": "rid-9"}


@pytest.mark.asyncio
async def test_job_run_gets_fresh_id_and_trigger():
    async def tick():
        run_id = start_job_run("injury-poll")
        return run_id, request_id_var.get(), trigger_var.get()

    run_id, rid, trigger = await asyncio.create_task(tick())
    assert rid == run_id and len(run_id) == 8
    assert trigger == "job:injury-poll"
