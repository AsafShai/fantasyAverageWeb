from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest

from . import client


def _resp(payload: dict) -> MagicMock:
    resp = MagicMock()
    resp.json.return_value = payload
    resp.raise_for_status = MagicMock()
    return resp


@pytest.mark.asyncio
async def test_async_get_json_returns_parsed_body():
    fake_client = MagicMock()
    fake_client.get = AsyncMock(return_value=_resp({'ok': True}))

    data = await client.async_get_json(fake_client, 'scoreboard', {'dates': '20260115'})

    assert data == {'ok': True}
    fake_client.get.assert_awaited_once()
    _, kwargs = fake_client.get.call_args
    assert kwargs['params'] == {'dates': '20260115'}


@pytest.mark.asyncio
async def test_async_get_json_raises_espn_unavailable_after_exhausting_retries(monkeypatch):
    monkeypatch.setattr(client, 'RETRY_DELAYS', [0.0, 0.0])
    fake_client = MagicMock()
    fake_client.get = AsyncMock(side_effect=httpx.ConnectError('down'))

    with pytest.raises(client.EspnUnavailableError):
        await client.async_get_json(fake_client, 'scoreboard')

    assert fake_client.get.await_count == 3  # len(RETRY_DELAYS) + 1


@pytest.mark.asyncio
async def test_scoreboard_async_builds_dates_and_limit_params():
    fake_client = MagicMock()
    fake_client.get = AsyncMock(return_value=_resp({'events': []}))

    await client.scoreboard_async(fake_client, '202601')

    _, kwargs = fake_client.get.call_args
    assert kwargs['params'] == {'dates': '202601', 'limit': 1000}


@pytest.mark.asyncio
async def test_calendar_whitelist_async_extracts_calendar_list():
    fake_client = MagicMock()
    fake_client.get = AsyncMock(return_value=_resp({
        'leagues': [{'calendar': ['2025-10-02T07:00Z', '2026-06-13T07:00Z']}],
    }))

    dates = await client.calendar_whitelist_async(fake_client)

    assert dates == ['2025-10-02T07:00Z', '2026-06-13T07:00Z']
    _, kwargs = fake_client.get.call_args
    assert kwargs['params'] == {'calendartype': 'whitelist'}


def test_headers_and_retry_delays_are_shared_between_sync_and_async_paths():
    assert client.HEADERS['Accept'] == 'application/json'
    assert client.RETRY_DELAYS == [2.0, 5.0, 15.0]
