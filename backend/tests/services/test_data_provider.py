import pytest
import httpx
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
