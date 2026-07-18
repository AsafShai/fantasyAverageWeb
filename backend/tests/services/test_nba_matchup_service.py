import re
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from app.services.nba_matchup_service import NbaMatchupService

_ET = ZoneInfo('America/New_York')


def _today() -> date:
    return datetime.now(_ET).date()


@pytest.fixture
def service():
    return NbaMatchupService()


# ESPN team ids: 13 = LAL, 30 = CHA, 20 = PHL (canonical abbr dialect)
_LAL_ID, _CHA_ID, _PHI_ID = 13, 30, 20


def _agg_row(team_id: int, pts: float, reb: float, pace: float) -> dict:
    return {
        'team_id': team_id, 'gp': 50,
        'opp_pts': pts, 'opp_reb': reb, 'opp_ast': 26.0, 'opp_stl': 8.2,
        'opp_blk': 5.1, 'opp_fg3m': 13.2, 'opp_fg_pct': 0.471, 'pace': pace,
    }


@pytest.fixture
def mock_agg_rows():
    return [
        _agg_row(_LAL_ID, pts=112.0, reb=44.0, pace=97.5),
        _agg_row(_CHA_ID, pts=118.0, reb=47.0, pace=101.8),
    ]


async def _def_data(service, rows):
    with patch.object(
        service._db, 'get_team_defense_aggregates', new_callable=AsyncMock, return_value=rows
    ):
        return await service.get_all_def_data()


@pytest.mark.asyncio
async def test_higher_opp_pts_gets_higher_rank(service, mock_agg_rows):
    data = await _def_data(service, mock_agg_rows)
    ranks = data['ranks']
    # CHA allows more PTS (118 > 112) → rank 2 (best matchup for 2-team sample)
    assert ranks['CHA']['pts'] > ranks['LAL']['pts']


@pytest.mark.asyncio
async def test_rank_values_within_bounds(service, mock_agg_rows):
    data = await _def_data(service, mock_agg_rows)
    for team_ranks in data['ranks'].values():
        for rank in team_ranks.values():
            assert 1 <= rank <= 30


@pytest.mark.asyncio
async def test_pace_keyed_by_canonical_abbr(service, mock_agg_rows):
    data = await _def_data(service, mock_agg_rows)
    pace = data['pace']
    assert 'CHA' in pace
    assert abs(pace['CHA'] - 101.8) < 0.01


@pytest.mark.asyncio
async def test_team_id_maps_to_canonical_abbr(service, mock_agg_rows):
    # ESPN team id 20 (Philadelphia) must surface as the canonical 'PHL'
    rows = [_agg_row(_PHI_ID, pts=112.0, reb=44.0, pace=97.5), mock_agg_rows[1]]
    data = await _def_data(service, rows)
    assert 'PHL' in data['ranks']
    assert 'PHI' not in data['ranks']


@pytest.mark.asyncio
async def test_def_values_populated(service, mock_agg_rows):
    data = await _def_data(service, mock_agg_rows)
    values = data['values']
    assert 'LAL' in values
    assert abs(values['LAL']['pts'] - 112.0) < 0.1
    assert abs(values['CHA']['reb'] - 47.0) < 0.1


@pytest.mark.asyncio
async def test_league_avg_values_populated(service, mock_agg_rows):
    data = await _def_data(service, mock_agg_rows)
    avgs = data['league_avg_values']
    assert abs(avgs['pts'] - 115.0) < 0.1  # (112 + 118) / 2


@pytest.mark.asyncio
async def test_empty_store_yields_empty_maps(service):
    data = await _def_data(service, [])
    assert data['ranks'] == {}
    assert data['values'] == {}
    assert data['league_avg_values'] == {}
    assert data['pace'] == {}


def test_pace_badge_fast(service):
    assert service.get_pace_badge(101.0, 97.0) == 'Fast'


def test_pace_badge_slow(service):
    assert service.get_pace_badge(94.0, 97.0) == 'Slow'


def test_pace_badge_average(service):
    assert service.get_pace_badge(97.5, 97.0) == 'Average'


def test_pace_badge_boundary_exact_plus_two(service):
    # exactly +2 is still Average, >2 is Fast
    assert service.get_pace_badge(99.0, 97.0) == 'Average'
    assert service.get_pace_badge(99.1, 97.0) == 'Fast'


def _scoreboard_event(home_id: int, away_id: int, home_abbr: str, away_abbr: str,
                      completed: bool, game_date: date, season_type: int = 2) -> dict:
    return {
        'date': f'{game_date.isoformat()}T19:00Z',  # midday ET regardless of DST
        'season': {'type': season_type},
        'status': {'type': {'completed': completed}},
        'competitions': [{
            'competitors': [
                {'homeAway': 'home', 'team': {'id': str(home_id), 'abbreviation': home_abbr}},
                {'homeAway': 'away', 'team': {'id': str(away_id), 'abbreviation': away_abbr}},
            ],
            'notes': [],
        }],
    }


def _resp(events: list[dict]) -> MagicMock:
    resp = MagicMock()
    resp.json.return_value = {'events': events}
    resp.raise_for_status = MagicMock()
    return resp


def _client_get_by_day(events_by_day: dict[date, list[dict]]):
    """Fake ``httpx.AsyncClient.get`` that answers both day ("YYYYMMDD") and
    whole-month ("YYYYMM") scoreboard requests from one day->events map —
    mirrors how ESPN's real scoreboard endpoint buckets by the requested range."""
    async def _get(url: str) -> MagicMock:
        key = re.search(r'dates=(\d+)', url).group(1)
        if len(key) == 8:
            d = date(int(key[:4]), int(key[4:6]), int(key[6:8]))
            return _resp(events_by_day.get(d, []))
        year, month = int(key[:4]), int(key[4:6])
        matched = [
            e for d, evs in events_by_day.items()
            if d.year == year and d.month == month for e in evs
        ]
        return _resp(matched)
    return _get


@pytest.mark.asyncio
async def test_get_games_today_both_directions(service):
    today = _today()
    events_by_day = {today: [_scoreboard_event(13, 30, 'LAL', 'CHA', completed=False, game_date=today)]}

    with patch.object(service._client, 'get', new_callable=AsyncMock, side_effect=_client_get_by_day(events_by_day)):
        games = await service.get_games_today()

    assert games['LAL'].opponent == 'CHA'
    assert games['LAL'].is_home is True
    assert games['CHA'].opponent == 'LAL'
    assert games['CHA'].is_home is False


@pytest.mark.asyncio
async def test_get_games_today_normalizes_site_abbrs(service):
    """ESPN scoreboards speak the site dialect (NY/GS/…); the games map must be
    keyed by the canonical dialect the fantasy side uses (NYK/GSW/…)."""
    today = _today()
    events_by_day = {today: [_scoreboard_event(18, 9, 'NY', 'GS', completed=False, game_date=today)]}

    with patch.object(service._client, 'get', new_callable=AsyncMock, side_effect=_client_get_by_day(events_by_day)):
        games = await service.get_games_today()

    assert games['NYK'].opponent == 'GSW'
    assert games['GSW'].opponent == 'NYK'


@pytest.mark.asyncio
async def test_default_view_rolls_forward_to_the_upcoming_slate(service):
    """ESPN's dateless scoreboard returns the NEAREST game day (the season
    finale all offseason), so the default view pins dates explicitly and rolls
    forward: today's slate all-final -> tomorrow's pending slate is shown."""
    today, tomorrow = _today(), _today() + timedelta(days=1)
    events_by_day = {
        today: [_scoreboard_event(13, 30, 'LAL', 'CHA', completed=True, game_date=today)],
        tomorrow: [_scoreboard_event(18, 9, 'NY', 'GS', completed=False, game_date=tomorrow)],
    }

    with patch.object(
        service._client, 'get', new_callable=AsyncMock, side_effect=_client_get_by_day(events_by_day),
    ) as get:
        games = await service.get_games_today()

    # month-batched: at most 2 calls (start month + end-of-lookahead month),
    # never one call per day of the 8-day window.
    assert len(get.call_args_list) <= 2
    for call in get.call_args_list:
        assert re.search(r'dates=\d{6}(&|$)', call[0][0])
    # the picked slate is the pending one, normalized to canonical abbrs
    assert games['NYK'].opponent == 'GSW'
    assert 'LAL' not in games
    assert service.get_schedule_date() == tomorrow.isoformat()


@pytest.mark.asyncio
async def test_get_schedule_date_is_none_with_no_upcoming_slate(service):
    with patch.object(
        service._client, 'get', new_callable=AsyncMock, side_effect=_client_get_by_day({}),
    ):
        await service.get_games_today()

    assert service.get_schedule_date() is None


@pytest.mark.asyncio
async def test_get_schedule_date_unset_before_any_default_view_call(service):
    assert service.get_schedule_date() is None


@pytest.mark.asyncio
async def test_default_view_empty_when_no_upcoming_slate(service):
    """Offseason: no games within the lookahead window -> empty map (never a
    stale past slate)."""
    with patch.object(
        service._client, 'get', new_callable=AsyncMock, side_effect=_client_get_by_day({}),
    ) as get:
        games = await service.get_games_today()

    assert games == {}
    assert len(get.call_args_list) <= 2  # month-batched, not one call per day


@pytest.mark.asyncio
async def test_upcoming_game_dates_skips_empty_days_and_counts_game_days(service):
    """Next-5-game-days scan: empty days are skipped, finished-today is skipped,
    only days with countable pending games are offered."""
    today = _today()
    offsets = {0: True, 1: None, 2: False, 3: False, 4: False, 5: None, 6: False, 7: False}
    events_by_day: dict[date, list[dict]] = {}
    for offset, completed in offsets.items():
        if completed is None:
            continue  # off day: no events
        d = today + timedelta(days=offset)
        events_by_day[d] = [_scoreboard_event(13, 30, 'LAL', 'CHA', completed=completed, game_date=d)]

    with patch.object(service._client, 'get', new_callable=AsyncMock, side_effect=_client_get_by_day(events_by_day)):
        dates = await service.get_upcoming_game_dates(count=5)

    assert len(dates) == 5
    assert dates == sorted(dates)  # chronological


@pytest.mark.asyncio
async def test_upcoming_game_dates_empty_in_offseason(service):
    with patch.object(
        service._client, 'get', new_callable=AsyncMock, side_effect=_client_get_by_day({}),
    ):
        dates = await service.get_upcoming_game_dates()

    assert dates == []


@pytest.mark.asyncio
async def test_explicit_date_is_used_verbatim(service):
    with patch.object(
        service._client, 'get', new_callable=AsyncMock, side_effect=_client_get_by_day({}),
    ) as get:
        await service.get_games_today(date='20260412')

    assert 'dates=20260412' in get.call_args[0][0]


@pytest.mark.asyncio
async def test_get_games_today_empty_on_no_games(service):
    with patch.object(
        service._client, 'get', new_callable=AsyncMock, side_effect=_client_get_by_day({}),
    ):
        games = await service.get_games_today()

    assert games == {}


def _whitelist_resp(calendar: list[str]) -> MagicMock:
    resp = MagicMock()
    resp.json.return_value = {'leagues': [{'calendar': calendar}]}
    resp.raise_for_status = MagicMock()
    return resp


def _whitelist_get(calendar: list[str]):
    """Fake ``httpx.AsyncClient.get`` for the whitelist-calendar request —
    real calls go through ``client.async_get_json`` with ``params=``, not an
    embedded query string, unlike the day/month scoreboard fakes above."""
    async def _get(url: str, params: dict | None = None, timeout=None) -> MagicMock:
        assert params == {'calendartype': 'whitelist'}
        return _whitelist_resp(calendar)
    return _get


@pytest.mark.asyncio
async def test_ensure_whitelist_parses_calendar_entries_to_et_dates(service):
    calendar = ['2025-10-02T07:00Z', '2026-01-29T08:00Z', '2026-06-13T07:00Z']

    with patch.object(service._client, 'get', new_callable=AsyncMock, side_effect=_whitelist_get(calendar)):
        await service._ensure_whitelist()

    assert service._whitelist_cache['dates'] == {
        date(2025, 10, 2), date(2026, 1, 29), date(2026, 6, 13),
    }


@pytest.mark.asyncio
async def test_ensure_whitelist_caches_for_24_hours(service):
    calendar = ['2025-10-02T07:00Z']

    with patch.object(
        service._client, 'get', new_callable=AsyncMock, side_effect=_whitelist_get(calendar),
    ) as get:
        await service._ensure_whitelist()
        await service._ensure_whitelist()

    assert get.await_count == 1


@pytest.mark.asyncio
async def test_ensure_whitelist_refetches_after_ttl_expiry(service):
    calendar = ['2025-10-02T07:00Z']
    service._whitelist_cache = {'dates': {date(2020, 1, 1)}, 'ts': datetime.now() - timedelta(hours=25)}

    with patch.object(
        service._client, 'get', new_callable=AsyncMock, side_effect=_whitelist_get(calendar),
    ) as get:
        await service._ensure_whitelist()

    assert get.await_count == 1
    assert service._whitelist_cache['dates'] == {date(2025, 10, 2)}
