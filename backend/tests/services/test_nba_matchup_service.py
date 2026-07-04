import pytest
from unittest.mock import AsyncMock, MagicMock, patch
import pandas as pd
from app.services.nba_matchup_service import NbaMatchupService


@pytest.fixture
def service():
    return NbaMatchupService()


_LAL_ID = 1610612747
_CHA_ID = 1610612766
_PHI_ID = 1610612755


@pytest.fixture
def mock_opp_df():
    return pd.DataFrame([
        {
            'TEAM_ID': _LAL_ID, 'TEAM_ABBREVIATION': 'LAL', 'OPP_PTS': 112.0, 'OPP_REB': 44.0,
            'OPP_AST': 26.0, 'OPP_STL': 8.2, 'OPP_BLK': 5.1,
            'OPP_FG3M': 13.2, 'OPP_FG_PCT': 0.471,
        },
        {
            'TEAM_ID': _CHA_ID, 'TEAM_ABBREVIATION': 'CHA', 'OPP_PTS': 118.0, 'OPP_REB': 47.0,
            'OPP_AST': 29.0, 'OPP_STL': 9.1, 'OPP_BLK': 6.3,
            'OPP_FG3M': 14.8, 'OPP_FG_PCT': 0.492,
        },
    ])


@pytest.fixture
def mock_adv_df():
    return pd.DataFrame([
        {'TEAM_ID': _LAL_ID, 'TEAM_ABBREVIATION': 'LAL', 'PACE': 97.5},
        {'TEAM_ID': _CHA_ID, 'TEAM_ABBREVIATION': 'CHA', 'PACE': 101.8},
    ])


def test_higher_opp_pts_gets_higher_rank(service, mock_opp_df, mock_adv_df):
    with patch.object(service, '_fetch_nba_stats', return_value=(mock_opp_df, mock_adv_df)):
        data = service.get_all_def_data()
    ranks = data['ranks']
    # CHA allows more PTS (118 > 112) → rank 2 (best matchup for 2-team sample)
    assert ranks['CHA']['pts'] > ranks['LAL']['pts']


def test_rank_values_within_bounds(service, mock_opp_df, mock_adv_df):
    with patch.object(service, '_fetch_nba_stats', return_value=(mock_opp_df, mock_adv_df)):
        data = service.get_all_def_data()
    for team_ranks in data['ranks'].values():
        for rank in team_ranks.values():
            assert 1 <= rank <= 30


def test_get_team_pace_returns_espn_key(service, mock_opp_df, mock_adv_df):
    with patch.object(service, '_fetch_nba_stats', return_value=(mock_opp_df, mock_adv_df)):
        data = service.get_all_def_data()
    pace = data['pace']
    assert 'CHA' in pace
    assert abs(pace['CHA'] - 101.8) < 0.01


def test_nba_abbr_converted_to_espn(service, mock_opp_df, mock_adv_df):
    # PHI in nba_api should become PHL in result
    phi_df = mock_opp_df.copy()
    phi_df.loc[0, 'TEAM_ID'] = _PHI_ID
    phi_df.loc[0, 'TEAM_ABBREVIATION'] = 'PHI'
    with patch.object(service, '_fetch_nba_stats', return_value=(phi_df, mock_adv_df)):
        data = service.get_all_def_data()
    ranks = data['ranks']
    assert 'PHL' in ranks
    assert 'PHI' not in ranks


def test_def_values_populated(service, mock_opp_df, mock_adv_df):
    with patch.object(service, '_fetch_nba_stats', return_value=(mock_opp_df, mock_adv_df)):
        data = service.get_all_def_data()
    values = data['values']
    assert 'LAL' in values
    assert abs(values['LAL']['pts'] - 112.0) < 0.1
    assert abs(values['CHA']['reb'] - 47.0) < 0.1


def test_league_avg_values_populated(service, mock_opp_df, mock_adv_df):
    with patch.object(service, '_fetch_nba_stats', return_value=(mock_opp_df, mock_adv_df)):
        data = service.get_all_def_data()
    avgs = data['league_avg_values']
    assert abs(avgs['pts'] - 115.0) < 0.1  # (112 + 118) / 2


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
async def test_get_games_today_empty_on_no_games(service):
    mock_data = {'events': []}
    mock_resp = MagicMock()
    mock_resp.json.return_value = mock_data
    mock_resp.raise_for_status = MagicMock()

    with patch.object(service._client, 'get', new_callable=AsyncMock, return_value=mock_resp):
        games = await service.get_games_today()

    assert games == {}
