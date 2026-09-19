from unittest.mock import AsyncMock, MagicMock

import pytest

from app.services.depth_chart_service import DepthChartFetchError, DepthChartService


@pytest.fixture(autouse=True)
def reset_depth_chart_service_singleton():
    DepthChartService._instance = None
    DepthChartService._initialized = False
    yield
    DepthChartService._instance = None
    DepthChartService._initialized = False


def _depthchart_json():
    return {
        "team": {"id": "13", "displayName": "Lakers"},
        "depthchart": [
            {
                "positions": {
                    "pg": {
                        "position": {"abbreviation": "PG"},
                        "athletes": [{"id": "900", "displayName": "Test Player"}],
                    }
                }
            }
        ],
    }


def _mock_resp(status_code=200, json_body=None):
    resp = MagicMock()
    resp.status_code = status_code
    resp.json.return_value = json_body if json_body is not None else _depthchart_json()
    return resp


@pytest.fixture
def service():
    return DepthChartService()


@pytest.mark.asyncio
async def test_get_depth_chart_raw_caches_within_ttl(service, monkeypatch):
    service._client.get = AsyncMock(return_value=_mock_resp())

    first = await service.get_depth_chart_raw(13)
    second = await service.get_depth_chart_raw(13)

    assert first == second == _depthchart_json()
    service._client.get.assert_called_once()


@pytest.mark.asyncio
async def test_get_depth_chart_raw_refetches_after_ttl_expiry(service, monkeypatch):
    service._client.get = AsyncMock(return_value=_mock_resp())

    await service.get_depth_chart_raw(13)

    fetched_at, data = service._cache[13]
    service._cache[13] = (fetched_at - 7201, data)

    await service.get_depth_chart_raw(13)

    assert service._client.get.call_count == 2


@pytest.mark.asyncio
async def test_get_depth_chart_raw_http_error_status_no_cache_entry(service):
    service._client.get = AsyncMock(return_value=_mock_resp(status_code=404))

    with pytest.raises(DepthChartFetchError) as exc_info:
        await service.get_depth_chart_raw(99)

    assert exc_info.value.is_network_error is False
    assert 99 not in service._cache


@pytest.mark.asyncio
async def test_get_depth_chart_raw_network_error_no_cache_entry(service):
    import httpx

    service._client.get = AsyncMock(side_effect=httpx.TimeoutException("timeout"))

    with pytest.raises(DepthChartFetchError) as exc_info:
        await service.get_depth_chart_raw(13)

    assert exc_info.value.is_network_error is True
    assert 13 not in service._cache


@pytest.mark.asyncio
async def test_get_on_depth_chart_names_happy_path(service):
    service._client.get = AsyncMock(return_value=_mock_resp())

    result = await service.get_on_depth_chart_names({"LAL"})

    assert result == {"LAL": {"testplayer"}}


@pytest.mark.asyncio
async def test_get_on_depth_chart_names_fails_open_on_error(service):
    import httpx

    service._client.get = AsyncMock(side_effect=httpx.TimeoutException("timeout"))

    result = await service.get_on_depth_chart_names({"LAL"})

    assert result == {"LAL": set()}
    assert 13 not in service._cache


@pytest.mark.asyncio
async def test_get_on_depth_chart_names_shares_cache_with_get_depth_chart_raw(service):
    service._client.get = AsyncMock(return_value=_mock_resp())

    await service.get_depth_chart_raw(13)
    await service.get_on_depth_chart_names({"LAL"})

    service._client.get.assert_called_once()


@pytest.mark.asyncio
async def test_singleton_shares_cache_across_instances(monkeypatch):
    first = DepthChartService()
    first._client.get = AsyncMock(return_value=_mock_resp())

    await first.get_depth_chart_raw(13)

    second = DepthChartService()
    assert second is first
    data = await second.get_depth_chart_raw(13)

    assert data == _depthchart_json()
    first._client.get.assert_called_once()
