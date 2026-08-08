import pandas as pd
import pytest

from app.services.cache_manager import CacheManager


@pytest.fixture(autouse=True)
def reset_cache_manager():
    cm = CacheManager()
    cm.invalidate_cache()
    yield
    cm.invalidate_cache()


class TestCacheManager:
    def test_invalidate_clears_both(self):
        cm = CacheManager()
        cm.totals_cache = {"etag": "t", "data": pd.DataFrame({"a": [1]})}
        cm.players_cache = {"etag": "p", "data": pd.DataFrame({"b": [2]})}
        info = cm.get_cache_info()
        assert info["has_totals"] and info["has_players"]
        cm.invalidate_cache()
        info2 = cm.get_cache_info()
        assert not info2["has_totals"] and not info2["has_players"]
        assert info2["totals_etag"] is None
        assert info2["players_etag"] is None

    def test_get_cache_info_shape(self):
        cm = CacheManager()
        info = cm.get_cache_info()
        assert set(info.keys()) == {"totals_etag", "players_etag", "has_totals", "has_players"}
