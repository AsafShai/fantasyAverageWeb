import asyncio
import pytest
import httpx
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock

import pandas as pd

from app.services.data_provider import DataProvider

pytestmark = pytest.mark.real_dataprovider
from app.exceptions import DataSourceError


def _api_teams_payload():
    return {
        "scoringPeriodId": 5,
        "teams": [
            {
                "id": 1,
                "name": " Alpha ",
                "valuesByStat": {
                    "0": 100,
                    "1": 2,
                    "2": 5,
                    "3": 20,
                    "6": 40,
                    "13": 40,
                    "14": 85,
                    "15": 15,
                    "16": 20,
                    "17": 10,
                    "19": 47.1,
                    "20": 75.0,
                    "42": 82,
                    "40": 2000,
                },
            }
        ],
    }


@pytest.fixture
def provider():
    DataProvider._instance = None
    DataProvider._initialized = False
    p = DataProvider()
    p._client = AsyncMock()
    p.db_service = AsyncMock()
    p.data_transformer = MagicMock()
    p.data_transformer.raw_standings_to_totals_df.return_value = pd.DataFrame(
        {"team_id": [1], "team_name": ["A"], "PTS": [10]}
    )
    p.data_transformer.raw_all_players_to_df.return_value = pd.DataFrame({"Name": ["P"], "team_id": [1]})
    p.data_transformer.totals_to_averages_df.return_value = pd.DataFrame({"team_id": [1]})
    p.data_transformer.averages_to_rankings_df.return_value = pd.DataFrame({"team_id": [1], "RANK": [1]})
    yield p
    DataProvider._instance = None
    DataProvider._initialized = False


@pytest.mark.asyncio
async def test_get_totals_200_caches_and_transforms(provider):
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.headers = {"ETag": "e1"}
    mock_resp.json.return_value = _api_teams_payload()
    provider._client.get = AsyncMock(return_value=mock_resp)

    df = await provider.get_totals_df()

    provider._client.get.assert_awaited()
    assert not df.empty
    assert provider.cache_manager.totals_cache["etag"] == "e1"
    mock_resp.raise_for_status.assert_called_once()


@pytest.mark.asyncio
async def test_get_totals_304_returns_cached(provider):
    cached = pd.DataFrame({"team_id": [99]})
    provider.cache_manager.totals_cache = {"etag": "old", "data": cached}

    mock_resp = MagicMock()
    mock_resp.status_code = 304
    provider._client.get = AsyncMock(return_value=mock_resp)

    df = await provider.get_totals_df()
    pd.testing.assert_frame_equal(df, cached)


@pytest.mark.asyncio
async def test_get_totals_failure_uses_memory_cache(provider):
    cached = pd.DataFrame({"team_id": [7]})
    provider.cache_manager.totals_cache = {"etag": "e", "data": cached}

    provider._client.get = AsyncMock(side_effect=RuntimeError("network"))

    df = await provider.get_totals_df()
    pd.testing.assert_frame_equal(df, cached)


@pytest.mark.asyncio
async def test_get_totals_failure_fallback_db(provider):
    provider.cache_manager.totals_cache = {"etag": None, "data": None}
    provider._client.get = AsyncMock(side_effect=RuntimeError("network"))
    provider.db_service.get_latest_snapshot = AsyncMock(
        return_value=("2025-01-01", [{"team_id": 1, "team_name": "T", "pts": 1, "date": "2025-01-01"}])
    )

    df = await provider.get_totals_df()
    assert "PTS" in df.columns or "team_id" in df.columns


@pytest.mark.asyncio
async def test_sync_db_now_returns_false_when_snapshot_current(provider):
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.headers = {}
    mock_resp.json.return_value = {"scoringPeriodId": 10, "teams": _api_teams_payload()["teams"]}
    provider._client.get = AsyncMock(return_value=mock_resp)
    provider.db_service.get_db_max_scoring_period = AsyncMock(return_value=99)

    ok = await provider.sync_db_now()
    assert ok is False


@pytest.mark.asyncio
async def test_get_players_df_fetch_error_raises(provider):
    provider.cache_manager.totals_cache["data"] = pd.DataFrame({"team_id": [1], "team_name": ["X"]})
    provider._client.get = AsyncMock(side_effect=httpx.ConnectError("x"))

    with pytest.raises(DataSourceError, match="Error fetching players"):
        await provider.get_players_df(0)


@pytest.mark.asyncio
async def test_get_players_df_304_returns_cached(provider):
    cached = pd.DataFrame({"Name": ["Cached"], "team_id": [1]})
    provider.cache_manager.players_0 = {"data": cached, "etag": "e1", "timestamp": datetime.now()}
    # Force the TTL check to be bypassed by expiring the timestamp, so the
    # 304 branch (not the fresh in-memory hit) is what's under test.
    from datetime import timedelta
    provider.cache_manager.players_0["timestamp"] = datetime.now() - timedelta(minutes=10)

    mock_resp = MagicMock()
    mock_resp.status_code = 304
    provider._client.get = AsyncMock(return_value=mock_resp)

    df = await provider.get_players_df(0)

    pd.testing.assert_frame_equal(df, cached)
    provider.data_transformer.raw_all_players_to_df.assert_not_called()


@pytest.mark.asyncio
async def test_get_players_df_sends_if_none_match(provider):
    from datetime import timedelta
    cached = pd.DataFrame({"Name": ["Cached"], "team_id": [1]})
    provider.cache_manager.players_0 = {
        "data": cached,
        "etag": "e1",
        "timestamp": datetime.now() - timedelta(minutes=10),
    }

    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.headers = {"ETag": "e2"}
    mock_resp.json.return_value = {"players": []}
    provider._client.get = AsyncMock(return_value=mock_resp)

    await provider.get_players_df(0)

    _, kwargs = provider._client.get.call_args
    assert kwargs["headers"]["If-None-Match"] == "e1"


@pytest.mark.asyncio
async def test_get_players_df_concurrent_calls_coalesce(provider):
    provider.cache_manager.totals_cache["data"] = pd.DataFrame({"team_id": [1], "team_name": ["A"]})
    provider.cache_manager.players_0 = {"data": None, "timestamp": None, "etag": None}
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.headers = {"ETag": "e1"}
    mock_resp.json.return_value = {"players": []}

    async def slow_get(*args, **kwargs):
        await asyncio.sleep(0.05)
        return mock_resp

    provider._client.get = AsyncMock(side_effect=slow_get)

    results = await asyncio.gather(
        provider.get_players_df(0),
        provider.get_players_df(0),
    )

    assert provider._client.get.await_count == 1
    pd.testing.assert_frame_equal(results[0], results[1])


@pytest.mark.asyncio
async def test_get_players_df_different_splits_do_not_block(provider):
    provider.cache_manager.totals_cache["data"] = pd.DataFrame({"team_id": [1], "team_name": ["A"]})
    provider.cache_manager.players_0 = {"data": None, "timestamp": None, "etag": None}
    provider.cache_manager.players_1 = {"data": None, "timestamp": None, "etag": None}
    mock_resp_0 = MagicMock()
    mock_resp_0.status_code = 200
    mock_resp_0.headers = {"ETag": "e-split0"}
    mock_resp_0.json.return_value = {"players": []}

    calls = []

    async def routed_get(*args, **kwargs):
        calls.append(kwargs)
        await asyncio.sleep(0.05)
        return mock_resp_0

    provider._client.get = AsyncMock(side_effect=routed_get)

    df0, df1 = await asyncio.gather(
        provider.get_players_df(0),
        provider.get_players_df(1),
    )

    assert provider._client.get.await_count == 2


@pytest.mark.asyncio
async def test_get_all_dataframes_tuple(provider):
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.headers = {"ETag": "e"}
    mock_resp.json.return_value = _api_teams_payload()
    provider._client.get = AsyncMock(return_value=mock_resp)

    totals = pd.DataFrame({"team_id": [1], "team_name": ["A"], "GP": [82], "PTS": [100]})
    provider.data_transformer.raw_standings_to_totals_df.return_value = totals
    avg = pd.DataFrame({"team_id": [1]})
    rnk = pd.DataFrame({"team_id": [1], "RANK": [1]})
    provider.data_transformer.totals_to_averages_df.return_value = avg
    provider.data_transformer.averages_to_rankings_df.return_value = rnk

    t, a, r = await provider.get_all_dataframes()
    assert len(t) == len(a) == len(r)


@pytest.mark.asyncio
async def test_get_all_dataframes_issues_single_espn_request(provider):
    """Resolving ranking categories must reuse the payload already fetched
    for totals, not issue its own ESPN request."""
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.headers = {"ETag": "e"}
    mock_resp.json.return_value = _api_teams_payload()
    provider._client.get = AsyncMock(return_value=mock_resp)

    totals = pd.DataFrame({"team_id": [1], "team_name": ["A"], "GP": [82], "PTS": [100]})
    provider.data_transformer.raw_standings_to_totals_df.return_value = totals
    provider.data_transformer.resolve_ranking_categories.return_value = ["PTS"]
    provider.data_transformer.totals_to_averages_df.return_value = pd.DataFrame({"team_id": [1]})
    provider.data_transformer.averages_to_rankings_df.return_value = pd.DataFrame({"team_id": [1], "RANK": [1]})

    await provider.get_all_dataframes()

    assert provider._client.get.await_count == 1


@pytest.mark.asyncio
async def test_get_averages_df_passes_resolved_categories(provider):
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.headers = {"ETag": "e"}
    mock_resp.json.return_value = _api_teams_payload()
    provider._client.get = AsyncMock(return_value=mock_resp)

    totals = pd.DataFrame({"team_id": [1], "team_name": ["A"], "GP": [82], "PTS": [100]})
    provider.data_transformer.raw_standings_to_totals_df.return_value = totals
    provider.data_transformer.resolve_ranking_categories.return_value = ["PTS", "TO"]

    await provider.get_averages_df()

    provider.data_transformer.totals_to_averages_df.assert_called_once_with(totals, ["PTS", "TO"])


@pytest.mark.asyncio
async def test_fallback_from_db_raises_when_no_rows(provider):
    """No DB fallback data for this league/season is a real 'nothing to
    serve' state, not a generic crash — the route layer maps DataSourceError
    to 503 so the frontend can show a specific message."""
    provider.db_service.get_latest_snapshot = AsyncMock(return_value=(None, []))

    with pytest.raises(DataSourceError, match="ESPN unavailable and no DB fallback data"):
        await provider._fallback_from_db()


@pytest.mark.asyncio
async def test_fallback_from_db_casts_decimal_columns_to_float(provider):
    """asyncpg returns Decimal for NUMERIC columns; the DB-fallback totals
    DataFrame must be uniformly float (like the ESPN path) so downstream
    consumers (e.g. the heatmap) don't crash mixing Decimal and float."""
    from decimal import Decimal

    rows = [{
        "team_id": 1, "team_name": "T", "date": "2025-01-01",
        "fg_pct": Decimal("46.7"), "ft_pct": Decimal("74.9"),
        "three_pm": Decimal("15"), "reb": Decimal("43"), "ast": Decimal("28"),
        "stl": Decimal("9"), "blk": Decimal("4"), "pts": Decimal("112"),
        "gp": Decimal("10"), "fgm": Decimal("40"), "fga": Decimal("85"),
        "ftm": Decimal("20"), "fta": Decimal("27"),
    }]
    provider.db_service.get_latest_snapshot = AsyncMock(return_value=("2025-01-01", rows))

    df = await provider._fallback_from_db()

    for col in ["FG%", "FT%", "3PM", "REB", "AST", "STL", "BLK", "PTS", "GP"]:
        assert df[col].dtype == float, f"{col} should be cast to float, got {df[col].dtype}"


@pytest.mark.asyncio
async def test_get_team_names_reuses_cached_raw_payload(provider):
    """Reuses the raw standings payload already cached by get_totals_df —
    doesn't make an extra ESPN request when one is already in memory."""
    provider.cache_manager.totals_cache["raw"] = {"teams": [{"id": 1, "name": "Alpha"}]}
    provider.data_transformer.raw_standings_to_team_names.return_value = [
        {"team_id": 1, "team_name": "Alpha"}
    ]
    provider._client.get = AsyncMock()

    result = await provider.get_team_names()

    provider._client.get.assert_not_awaited()
    provider.data_transformer.raw_standings_to_team_names.assert_called_once_with(
        {"teams": [{"id": 1, "name": "Alpha"}]}
    )
    assert result == [{"team_id": 1, "team_name": "Alpha"}]


@pytest.mark.asyncio
async def test_get_team_names_fetches_fresh_when_nothing_cached(provider):
    """No cached payload yet (e.g. totals were never successfully fetched
    this run, as in preseason) -> a fresh standings request is made."""
    provider.cache_manager.totals_cache["raw"] = None
    raw_payload = {"teams": [{"id": 2, "name": "Beta"}]}
    mock_resp = MagicMock()
    mock_resp.json.return_value = raw_payload
    provider._client.get = AsyncMock(return_value=mock_resp)
    provider.data_transformer.raw_standings_to_team_names.return_value = [
        {"team_id": 2, "team_name": "Beta"}
    ]

    result = await provider.get_team_names()

    provider._client.get.assert_awaited_once()
    mock_resp.raise_for_status.assert_called_once()
    assert provider.cache_manager.totals_cache["raw"] == raw_payload
    assert result == [{"team_id": 2, "team_name": "Beta"}]


@pytest.mark.asyncio
async def test_get_team_names_raises_data_source_error_on_fetch_failure(provider):
    provider.cache_manager.totals_cache["raw"] = None
    provider._client.get = AsyncMock(side_effect=httpx.ConnectError("down"))

    with pytest.raises(DataSourceError, match="Error fetching team names"):
        await provider.get_team_names()


@pytest.mark.asyncio
async def test_get_ranking_categories_delegates_to_transformer(provider):
    """get_ranking_categories reads the raw payload already cached by a prior
    get_totals_df() call rather than fetching itself, so callers within the
    same request never trigger a second ESPN round trip."""
    provider.cache_manager.totals_cache = {"etag": "e1", "data": None, "raw": _api_teams_payload()}
    provider.data_transformer.resolve_ranking_categories.return_value = ["PTS", "TO"]

    categories = await provider.get_ranking_categories()

    assert categories == ["PTS", "TO"]
    provider.data_transformer.resolve_ranking_categories.assert_called_once_with(_api_teams_payload())
    provider._client.get.assert_not_called()


@pytest.mark.asyncio
async def test_get_ranking_categories_falls_back_when_no_raw_cached(provider):
    from app.utils.constants import RANKING_CATEGORIES

    provider.cache_manager.totals_cache = {"etag": None, "data": pd.DataFrame({"team_id": [1]})}

    categories = await provider.get_ranking_categories()

    assert categories == list(RANKING_CATEGORIES)
    provider._client.get.assert_not_called()
