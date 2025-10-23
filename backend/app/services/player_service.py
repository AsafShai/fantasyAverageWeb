import logging
from typing import List
from app.models import Player, PaginatedPlayers
from app.exceptions import ResourceNotFoundError
from app.services.data_provider import DataProvider
from app.builders.response_builder import ResponseBuilder

class PlayerService:
    """Service for player-related operations"""

    def __init__(self):
        self.data_provider = DataProvider()
        self.response_builder = ResponseBuilder()
        self.logger = logging.getLogger(__name__)

    async def get_all_players(self, page: int = 1, limit: int = 500) -> PaginatedPlayers:
        """Get all players with pagination"""
        players_df = await self.data_provider.get_players_df()

        if players_df is None or players_df.empty:
            raise ResourceNotFoundError("No players found")

        total_count = len(players_df)
        start_idx = (page - 1) * limit
        end_idx = start_idx + limit

        page_df = players_df.iloc[start_idx:end_idx]
        players = self.response_builder.build_all_players_response(page_df)

        return PaginatedPlayers(
            players=players,
            total_count=total_count,
            page=page,
            limit=limit,
            has_more=end_idx < total_count
        )
