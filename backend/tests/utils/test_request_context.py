import logging

from app.utils.request_context import RequestIdFilter, new_request_id, request_id_var


def test_new_request_id_reuses_sane_incoming_value():
    assert new_request_id("abc-123") == "abc-123"


def test_new_request_id_mints_when_missing_or_unreasonable():
    assert len(new_request_id(None)) == 8
    assert len(new_request_id("x" * 500)) == 8
    assert len(new_request_id("bad\nid")) == 8


def test_filter_stamps_current_request_id():
    record = logging.LogRecord("t", logging.INFO, __file__, 1, "msg", None, None)
    token = request_id_var.set("rid-1")
    try:
        assert RequestIdFilter().filter(record) is True
    finally:
        request_id_var.reset(token)
    assert record.request_id == "rid-1"
