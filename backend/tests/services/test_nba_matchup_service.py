import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from app.services.nba_matchup_service import NbaMatchupService


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


@pytest.mark.asyncio
async def test_get_games_today_both_directions(service):
    mock_data = {
        'events': [{
            'competitions': [{
                'competitors': [
                    {'homeAway': 'home', 'team': {'abbreviation': 'LAL'}},
                    {'homeAway': 'away', 'team': {'abbreviation': 'CHA'}},
                ]
            }]
        }]
    }
    mock_resp = MagicMock()
    mock_resp.json.return_value = mock_data
    mock_resp.raise_for_status = MagicMock()

    with patch.object(service._client, 'get', new_callable=AsyncMock, return_value=mock_resp):
        games = await service.get_games_today()

    assert games['LAL'].opponent == 'CHA'
    assert games['LAL'].is_home is True
    assert games['CHA'].opponent == 'LAL'
    assert games['CHA'].is_home is False


@pytest.mark.asyncio
async def test_get_games_today_normalizes_site_abbrs(service):
    """ESPN scoreboards speak the site dialect (NY/GS/…); the games map must be
    keyed by the canonical dialect the fantasy side uses (NYK/GSW/…)."""
    mock_data = {
        'events': [{
            'competitions': [{
                'competitors': [
                    {'homeAway': 'home', 'team': {'abbreviation': 'NY'}},
                    {'homeAway': 'away', 'team': {'abbreviation': 'GS'}},
                ]
            }]
        }]
    }
    mock_resp = MagicMock()
    mock_resp.json.return_value = mock_data
    mock_resp.raise_for_status = MagicMock()

    with patch.object(service._client, 'get', new_callable=AsyncMock, return_value=mock_resp):
        games = await service.get_games_today()

    assert games['NYK'].opponent == 'GSW'
    assert games['GSW'].opponent == 'NYK'


@pytest.mark.asyncio
async def test_get_games_today_always_pins_the_date(service):
    """ESPN's dateless scoreboard returns the NEAREST game day (the season
    finale all offseason), so the request must always carry an explicit
    dates= param — US/Eastern today when none is given."""
    mock_resp = MagicMock()
    mock_resp.json.return_value = {'events': []}
    mock_resp.raise_for_status = MagicMock()

    with patch.object(service._client, 'get', new_callable=AsyncMock, return_value=mock_resp) as get:
        await service.get_games_today()
        url_default = get.call_args[0][0]
        await service.get_games_today(date='20260412')
        url_explicit = get.call_args[0][0]

    assert 'dates=' in url_default
    import re
    assert re.search(r'dates=\d{8}$', url_default)
    assert url_explicit.endswith('dates=20260412')


@pytest.mark.asyncio
async def test_get_games_today_empty_on_no_games(service):
    mock_data = {'events': []}
    mock_resp = MagicMock()
    mock_resp.json.return_value = mock_data
    mock_resp.raise_for_status = MagicMock()

    with patch.object(service._client, 'get', new_callable=AsyncMock, return_value=mock_resp):
        games = await service.get_games_today()

    assert games == {}
