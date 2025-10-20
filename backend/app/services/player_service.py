import logging
from typing import List
from app.models import Player
from app.exceptions import ResourceNotFoundError
from app.services.data_provider import DataProvider
from app.builders.response_builder import ResponseBuilder

class PlayerService:
    """Service for player-related operations"""

    def __init__(self):
        self.data_provider = DataProvider()
        self.response_builder = ResponseBuilder()
        self.logger = logging.getLogger(__name__)

    async def get_all_players(self) -> List[Player]:
        """Get list of all players in the league"""
        players_df = await self.data_provider.get_players_df()
        if players_df is None or players_df.empty:
            raise ResourceNotFoundError("No players found in the data")

        return self.response_builder.build_all_players_response(players_df)
