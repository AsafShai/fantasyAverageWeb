from app.models import TradeSuggestionsResponse, Team, TradeSuggestionAIResponse, TradeSuggestion, Player
from app.services.data_provider import DataProvider, get_data_provider
from app.exceptions import ResourceNotFoundError, DataSourceError
from app.utils.utils import is_team_exists
from app.services.ai_service import AIService, get_ai_service
from fastapi import Depends
from typing import Annotated, List
import logging
import asyncio

# Dependency type aliases
DataProviderDep = Annotated[DataProvider, Depends(get_data_provider)]
AIServiceDep = Annotated[AIService, Depends(get_ai_service)]

class TradesService:

    def __init__(self, data_provider: DataProvider, ai_service: AIService):
        self.data_provider = data_provider
        self.ai_service = ai_service
        self.logger = logging.getLogger(__name__)

    async def get_trades_suggestions_by_team_id(self, team_id: int) -> TradeSuggestionsResponse:
        try:
            standings_task = self.data_provider.get_all_dataframes()
            players_task = self.data_provider.get_players_df()
            
            (totals_df, averages_df, rankings_df), players_df = await asyncio.gather(
                standings_task,
                players_task
            )
            
            if not is_team_exists(team_id, totals_df):
                self.logger.warning(f"Team {team_id} not found in data")
                raise ResourceNotFoundError(f"Team with ID {team_id} not found")
            
            team_name = totals_df[totals_df['team_id'] == team_id]['team_name'].values[0]
            
            if players_df is None:
                self.logger.error("Failed to load players data from ESPN API")
                raise DataSourceError("Unable to process players data from ESPN API")
            
            team_players_df = players_df[players_df['team_id'] == team_id]
            if team_players_df.empty:
                self.logger.warning(f"No players found for team {team_id}")
                raise ResourceNotFoundError(f"No players found for team ID {team_id}, unable to trade")
            
            ai_response: TradeSuggestionAIResponse = self.ai_service.get_trade_suggestions(team_id, players_df, totals_df, rankings_df, averages_df)
            trade_suggestions = self._get_trade_suggestions(totals_df, players_df, ai_response)
            
            return TradeSuggestionsResponse(
                user_team=Team(team_id=team_id, team_name=team_name),
                trade_suggestions=trade_suggestions
            )
            
        except (ResourceNotFoundError, DataSourceError):
            raise
        except Exception as e:
            self.logger.error(f"Unexpected error generating trade suggestions for team {team_id}: {e}", exc_info=True)
            raise DataSourceError(f"Unable to get trade suggestions for team ID {team_id}") from e

    def _get_trade_suggestions(self, totals_df, players_df, ai_response: TradeSuggestionAIResponse) -> List[TradeSuggestion]:
        trade_suggestions = []
            
        for i, trade_ai in enumerate(ai_response.trade_suggestions):
            try:
                opponent_team = self._get_team_by_name(trade_ai.opponent_team, totals_df)
                players_to_give = self._get_players_from_names_list(trade_ai.players_to_give, players_df)
                players_to_receive = self._get_players_from_names_list(trade_ai.players_to_receive, players_df)
                    
                trade_suggestions.append(TradeSuggestion(
                        opponent_team=opponent_team,
                        players_to_give=players_to_give,
                        players_to_receive=players_to_receive,
                        reasoning=trade_ai.reasoning
                    ))
            except Exception as e:
                self.logger.warning(f"Failed to process trade suggestion {i+1}: {e}")
                continue
        return trade_suggestions
        

    def _get_team_by_name(self, team_name: str, totals_df) -> Team:
        """Get Team object by team ID"""
        team_row = totals_df[totals_df['team_name'] == team_name]
        if team_row.empty:
            raise ResourceNotFoundError(f"Team with Name {team_name} not found")
        team_id = team_row['team_id'].iloc[0]
        return Team(team_id=team_id, team_name=team_name)

    def _get_players_from_names_list(self, names_list: List[str], players_df) -> List[Player]:
        """Convert list of player names to Player objects"""
        from app.models import PlayerStats
        
        players = []
        for name in names_list:
            player_row = players_df[players_df['Name'] == name]
            if not player_row.empty:
                row = player_row.iloc[0]
                player = Player(
                    player_name=str(row['Name']),
                    pro_team=str(row['Pro Team']),
                    positions=str(row['Positions']).split(', '),
                    stats=PlayerStats(
                        pts=float(row['PTS']),
                        reb=float(row['REB']),
                        ast=float(row['AST']),
                        stl=float(row['STL']),
                        blk=float(row['BLK']),
                        fgm=float(row['FGM']),
                        fga=float(row['FGA']),
                        ftm=float(row['FTM']),
                        fta=float(row['FTA']),
                        fg_percentage=float(row['FG%']),
                        ft_percentage=float(row['FT%']),
                        three_pm=float(row['3PM']),
                        gp=int(row['GP'])
                    )
                )
                players.append(player)
        return players

def get_trades_service(
    data_provider: DataProviderDep,
    ai_service: AIServiceDep
) -> TradesService:
    return TradesService(data_provider, ai_service)

