import pytest
import pandas as pd
from unittest.mock import patch, AsyncMock
from app.services.draft_report_service import DraftReportService
from app.exceptions import ResourceNotFoundError


@pytest.fixture
def draft_report_service():
    with patch('app.services.draft_report_service.DataProvider'):
        service = DraftReportService()
        service.data_provider = AsyncMock()
        return service


@pytest.fixture
def sample_totals_df():
    return pd.DataFrame({'team_id': [1, 2], 'team_name': ['Team Alpha', 'Team Beta']})


class TestDraftReportService:
    @pytest.mark.asyncio
    async def test_get_draft_report_joins_picks(self, draft_report_service, sample_totals_df):
        draft_report_service.data_provider.get_draft_detail_raw.return_value = {
            'draftDetail': {'picks': [
                {'overallPickNumber': 2, 'roundId': 1, 'teamId': 2, 'playerId': 201},
                {'overallPickNumber': 1, 'roundId': 1, 'teamId': 1, 'playerId': 101},
            ]}
        }
        draft_report_service.data_provider.get_players_directory.return_value = {101: 'Player A1', 201: 'Player B1'}
        draft_report_service.data_provider.get_totals_df.return_value = sample_totals_df

        result = await draft_report_service.get_draft_report()

        assert [p.pick for p in result.picks] == [1, 2]
        assert result.picks[0].player_name == 'Player A1'
        assert result.picks[0].team_name == 'Team Alpha'

    @pytest.mark.asyncio
    async def test_get_draft_report_skips_unmatched_player(self, draft_report_service, sample_totals_df):
        draft_report_service.data_provider.get_draft_detail_raw.return_value = {
            'draftDetail': {'picks': [
                {'overallPickNumber': 1, 'roundId': 1, 'teamId': 1, 'playerId': 101},
                {'overallPickNumber': 2, 'roundId': 1, 'teamId': 2, 'playerId': 999},
            ]}
        }
        draft_report_service.data_provider.get_players_directory.return_value = {101: 'Player A1'}
        draft_report_service.data_provider.get_totals_df.return_value = sample_totals_df

        result = await draft_report_service.get_draft_report()

        assert len(result.picks) == 1
        assert result.picks[0].player_name == 'Player A1'

    @pytest.mark.asyncio
    async def test_get_draft_report_unknown_team_falls_back(self, draft_report_service, sample_totals_df):
        draft_report_service.data_provider.get_draft_detail_raw.return_value = {
            'draftDetail': {'picks': [
                {'overallPickNumber': 1, 'roundId': 1, 'teamId': 99, 'playerId': 101},
            ]}
        }
        draft_report_service.data_provider.get_players_directory.return_value = {101: 'Player A1'}
        draft_report_service.data_provider.get_totals_df.return_value = sample_totals_df

        result = await draft_report_service.get_draft_report()

        assert result.picks[0].team_name == 'Unknown Team'

    @pytest.mark.asyncio
    async def test_get_draft_report_no_picks_raises(self, draft_report_service, sample_totals_df):
        draft_report_service.data_provider.get_draft_detail_raw.return_value = {'draftDetail': {'picks': []}}
        draft_report_service.data_provider.get_players_directory.return_value = {}
        draft_report_service.data_provider.get_totals_df.return_value = sample_totals_df

        with pytest.raises(ResourceNotFoundError):
            await draft_report_service.get_draft_report()
