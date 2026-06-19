import logging
from typing import List
from app.models import Player, StatTimePeriod
from app.exceptions import ResourceNotFoundError
from app.services.data_provider import DataProvider
from app.builders.response_builder import ResponseBuilder


class PlayerRankingsService:
    def __init__(self):
        self.data_provider = DataProvider()
        self.response_builder = ResponseBuilder()
        self.logger = logging.getLogger(__name__)

    async def get_player_rankings(self, period: StatTimePeriod = StatTimePeriod.SEASON) -> List[Player]:
        players_df = await self.data_provider.get_players_df(StatTimePeriod.to_stat_split_id(period))
        if players_df is None or players_df.empty:
            raise ResourceNotFoundError("No players found")
        return self.response_builder.build_all_players_response(players_df)
