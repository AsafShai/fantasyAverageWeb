import logging

from app.utils import memory


def test_snapshot_reads_rss_on_linux():
    snap = memory.memory_snapshot()
    assert snap["rss"] is not None and snap["rss"] > 0


def test_log_memory_warns_near_limit(monkeypatch, caplog):
    monkeypatch.setattr(
        memory, "memory_snapshot",
        lambda: {"rss": 400 << 20, "usage": 450 << 20, "limit": 512 << 20},
    )
    with caplog.at_level(logging.INFO):
        memory.log_memory("step x")
    rec = caplog.records[-1]
    assert rec.levelno == logging.WARNING
    assert "step x" in rec.message and "450MB/512MB (88%)" in rec.message


def test_log_memory_info_without_cgroup(monkeypatch, caplog):
    monkeypatch.setattr(
        memory, "memory_snapshot", lambda: {"rss": 100 << 20, "usage": None, "limit": None}
    )
    with caplog.at_level(logging.INFO):
        memory.log_memory("step y")
    rec = caplog.records[-1]
    assert rec.levelno == logging.INFO
    assert rec.message == "[mem] step y: rss=100MB"
