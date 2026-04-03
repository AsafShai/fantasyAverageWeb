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
    def test_miss_then_hit_totals(self):
        cm = CacheManager()
        calls = {"n": 0}

        def calc():
            calls["n"] += 1
            return pd.DataFrame({"a": [1]})

        df1 = cm.get_totals("etag-a", calc)
        df2 = cm.get_totals("etag-a", calc)
        assert calls["n"] == 1
        pd.testing.assert_frame_equal(df1, df2)

    def test_new_etag_recomputes(self):
        cm = CacheManager()
        calls = {"n": 0}

        def calc():
            calls["n"] += 1
            return pd.DataFrame({"x": [calls["n"]]})

        cm.get_totals("e1", calc)
        cm.get_totals("e2", calc)
        assert calls["n"] == 2

    def test_calculator_returns_none_does_not_cache(self):
        cm = CacheManager()
        calls = {"n": 0}

        def calc():
            calls["n"] += 1
            return None

        assert cm.get_totals("e", calc) is None
        assert cm.get_totals("e", calc) is None
        assert calls["n"] == 2

    def test_invalidate_clears_both(self):
        cm = CacheManager()
        cm.get_totals("t", lambda: pd.DataFrame({"a": [1]}))
        cm.get_players("p", lambda: pd.DataFrame({"b": [2]}))
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
