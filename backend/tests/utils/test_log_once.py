import logging

from app.utils import log_once
from app.utils.log_once import warn_on_change

logger = logging.getLogger("test.log_once")


def test_repeat_of_same_set_drops_to_debug_and_a_new_set_warns_again(caplog):
    log_once.reset()
    with caplog.at_level(logging.DEBUG, logger="test.log_once"):
        warn_on_change(logger, "k", ["b", "a"], "first")
        warn_on_change(logger, "k", ["a", "b"], "repeat")
        warn_on_change(logger, "k", ["a", "c"], "changed")
    assert [(r.levelname, r.getMessage()) for r in caplog.records] == [
        ("WARNING", "first"), ("DEBUG", "repeat"), ("WARNING", "changed"),
    ]
