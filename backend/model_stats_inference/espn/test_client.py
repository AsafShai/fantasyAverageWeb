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


# --- sync path (nightly ingest) ------------------------------------------------

def _transport(handler):
    return httpx.Client(headers=client.HEADERS, follow_redirects=True, transport=httpx.MockTransport(handler))


def test_sync_get_json_sends_params_and_headers(monkeypatch):
    seen = {}

    def handler(request):
        seen['url'] = str(request.url)
        seen['accept'] = request.headers.get('accept')
        return httpx.Response(200, json={'ok': True})

    monkeypatch.setattr(client, '_session', _transport(handler))
    monkeypatch.setattr(client, 'SLEEP_BETWEEN_CALLS', 0)
    assert client.get_json('scoreboard', {'dates': '20261119', 'limit': '100'}) == {'ok': True}
    assert seen['url'] == f'{client.BASE}/scoreboard?dates=20261119&limit=100'
    assert seen['accept'] == 'application/json'


def test_sync_get_json_follows_redirects_like_requests_did(monkeypatch):
    def handler(request):
        if request.url.path.endswith('/old'):
            return httpx.Response(301, headers={'location': f'{client.BASE}/new'})
        return httpx.Response(200, json={'moved': True})

    monkeypatch.setattr(client, '_session', _transport(handler))
    monkeypatch.setattr(client, 'SLEEP_BETWEEN_CALLS', 0)
    assert client.get_json('old') == {'moved': True}


def test_sync_get_json_retries_http_errors_and_bad_json_then_gives_up(monkeypatch):
    calls = []

    def handler(request):
        calls.append(1)
        if len(calls) == 1:
            return httpx.Response(503, text='busy')
        if len(calls) == 2:
            return httpx.Response(200, text='not json')
        raise httpx.ConnectError('down')

    monkeypatch.setattr(client, '_session', _transport(handler))
    monkeypatch.setattr(client.time, 'sleep', lambda _s: None)
    import pytest
    with pytest.raises(client.EspnUnavailableError):
        client.get_json('scoreboard')
    assert len(calls) == len(client.RETRY_DELAYS) + 1


def test_sync_get_json_recovers_after_a_failed_attempt(monkeypatch):
    calls = []

    def handler(request):
        calls.append(1)
        return httpx.Response(500) if len(calls) == 1 else httpx.Response(200, json={'n': 2})

    monkeypatch.setattr(client, '_session', _transport(handler))
    monkeypatch.setattr(client.time, 'sleep', lambda _s: None)
    assert client.get_json('x') == {'n': 2}
