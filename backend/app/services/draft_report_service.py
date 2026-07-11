import logging
from app.models import DraftReport, DraftPick
from app.services.data_provider import DataProvider
from app.exceptions import ResourceNotFoundError


class DraftReportService:
    """Service for the live draft report card (picks joined to player/team names)"""

    def __init__(self):
        self.data_provider = DataProvider()
        self.logger = logging.getLogger(__name__)

    async def get_draft_report(self) -> DraftReport:
        draft_data, players_directory, totals_df = await self._fetch_dependencies()

        picks_raw = draft_data.get('draftDetail', {}).get('picks', [])
        if not picks_raw:
            raise ResourceNotFoundError("No draft picks found for this league")

        team_names = dict(zip(totals_df['team_id'], totals_df['team_name']))

        picks = []
        for pick in picks_raw:
            player_name = players_directory.get(pick['playerId'])
            if player_name is None:
                self.logger.warning(f"Draft report: no player name for playerId={pick['playerId']}")
                continue
            picks.append(DraftPick(
                pick=pick['overallPickNumber'],
                round=pick['roundId'],
                team_id=pick['teamId'],
                team_name=team_names.get(pick['teamId'], 'Unknown Team'),
                player_name=player_name,
            ))

        picks.sort(key=lambda p: p.pick)
        return DraftReport(picks=picks)

    async def _fetch_dependencies(self):
        draft_data = await self.data_provider.get_draft_detail_raw()
        players_directory = await self.data_provider.get_players_directory()
        totals_df = await self.data_provider.get_totals_df()
        return draft_data, players_directory, totals_df
