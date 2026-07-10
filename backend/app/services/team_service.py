import asyncio
import logging
from datetime import date
from typing import List, Optional
from app.models import TeamDetail, TeamPlayers, Team, StatTimePeriod
from app.exceptions import InvalidParameterError, ResourceNotFoundError
from app.services.data_provider import DataProvider
from app.services.player_service import build_windowed_players_df
from app.builders.response_builder import ResponseBuilder
from app.utils.utils import is_team_exists
from app.config import settings

class TeamService:
    """Service for team-related operations"""

    def __init__(self):
        self.data_provider = DataProvider()
        self.response_builder = ResponseBuilder()
        self.logger = logging.getLogger(__name__)

    async def get_team_detail(
        self,
        team_id: int,
        time_period: StatTimePeriod = StatTimePeriod.SEASON,
        start: Optional[date] = None,
        end: Optional[date] = None,
    ) -> TeamDetail:
        """Get detailed team statistics including roster and ESPN link

        Args:
            team_id: Team ID
            time_period: Time period for player stats
            start: Start date, required when time_period is custom
            end: End date, required when time_period is custom
        """
        if time_period == StatTimePeriod.CUSTOM and (start is None or end is None):
            raise InvalidParameterError("custom time_period requires both start and end")

        stat_split_id = StatTimePeriod.to_stat_split_id(time_period)

        totals_df, averages_df, rankings_df = await self.data_provider.get_all_dataframes()

        if totals_df is None or averages_df is None or rankings_df is None:
            raise ResourceNotFoundError("Unable to process ESPN data")

        if not is_team_exists(team_id, totals_df):
            raise ResourceNotFoundError(f"Team with ID {team_id} not found")

        players_list = None
        slot_usage_map = {}
        actual_start = None
        actual_end = None
        try:
            players_df, slot_usage_map = await asyncio.gather(
                self.data_provider.get_players_df(stat_split_id),
                self.data_provider.get_slot_usage()
            )
            if players_df is not None:
                players_df, actual_start, actual_end = await build_windowed_players_df(
                    time_period, players_df, self.data_provider.db_service, start, end
                )
                team_players_df = self._filter_team_players(players_df, team_id)
                players_list = self.response_builder.build_players_list(team_players_df)
        except Exception as e:
            self.logger.warning(f"Player data unavailable for team {team_id}: {e}")

        espn_url = f"https://fantasy.espn.com/basketball/team?leagueId={settings.league_id}&teamId={team_id}"
        team_slot_usage = slot_usage_map.get(team_id, {})

        return self.response_builder.build_team_detail_response(
            team_id, totals_df, averages_df, rankings_df, players_list, espn_url,
            team_slot_usage, data_date=self.data_provider.get_data_date(),
            actual_start=actual_start, actual_end=actual_end,
        )
    
    async def get_teams_list(self) -> List[Team]:
        """Get list of all teams"""
        totals_df = await self.data_provider.get_totals_df()
        if totals_df is None:
            raise Exception("Unable to fetch teams data from ESPN API")
        
        teams = self._extract_teams_from_dataframe(totals_df)
        
        if not teams:
            raise ResourceNotFoundError("No teams found in the data")
        
        return teams
    
    async def get_team_players(self, team_id: int) -> TeamPlayers:
        """Get players for a specific team by team ID"""
        players_df = await self.data_provider.get_players_df()
        if players_df is None:
            raise Exception("Unable to process player data")

        team_players = self._filter_team_players(players_df, team_id)

        if team_players.empty:
            raise ResourceNotFoundError(f"No players found for team ID {team_id}")

        return self.response_builder.build_team_players_response(team_players)
    
    def _extract_teams_from_dataframe(self, totals_df) -> List[Team]:
        """Extract teams list from dataframe with validation"""
        teams = []
        for team_id, team_name in zip(totals_df['team_id'], totals_df['team_name']):
            if team_id and team_name:
                teams.append(Team(team_id=int(team_id), team_name=str(team_name).strip()))
        return teams
    
    def _filter_team_players(self, players_df, team_id: int):
        """Filter players for a specific team"""
        return players_df.loc[players_df['team_id'] == team_id]
