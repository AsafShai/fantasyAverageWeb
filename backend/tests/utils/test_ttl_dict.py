from app.utils import ttl_dict


def test_store_sweeps_expired_entries_on_write():
    cache = {"old": (5.0, "a"), "live": (50.0, "b")}
    ttl_dict.prune(cache, max_entries=10, now=10.0)
    assert cache == {"live": (50.0, "b")}


def test_store_caps_count_dropping_oldest_written():
    cache: dict = {}
    for i in range(5):
        ttl_dict.store(cache, i, 1e12, f"v{i}", max_entries=3)
    assert list(cache) == [2, 3, 4]


def test_rewrite_moves_key_to_newest():
    cache: dict = {}
    for key in ("a", "b", "c"):
        ttl_dict.store(cache, key, 1e12, key, max_entries=3)
    ttl_dict.store(cache, "a", 1e12, "a2", max_entries=3)
    ttl_dict.store(cache, "d", 1e12, "d", max_entries=3)
    assert list(cache) == ["c", "a", "d"]
    assert cache["a"] == (1e12, "a2")


def test_keys_never_read_again_do_not_accumulate():
    # The leak this guards against: a key written once and never read again.
    cache: dict = {}
    for night in range(500):
        ttl_dict.store(cache, f"box:{night}", 1e12, {"night": night}, max_entries=64)
    assert len(cache) == 64
