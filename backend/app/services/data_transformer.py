import pandas as pd
import logging
from typing import Dict
from app.utils.constants import (
    ESPN_COLUMN_MAP, ALL_CATEGORIES, INTEGER_COLUMNS, PRO_TEAM_MAP, POSITION_MAP
)
from app.services.stats_calculator import StatsCalculator
from app.config import settings


class DataTransformer:
    """Transforms raw ESPN data into clean pandas DataFrames"""
    
    def __init__(self):
        self.logger = logging.getLogger(__name__)
        self.stats_calculator = StatsCalculator()
    
    def raw_all_players_to_df(self, espn_data: Dict, stat_split_type_id: int = 0) -> pd.DataFrame:
        """
        Convert ESPN kona_player_info API data to DataFrame (all 500 players including FA/waivers)
        Args:
            espn_data: Raw ESPN API response with 'players' array
            stat_split_type_id: ESPN stat split type (0=season, 1=last7, 2=last15, 3=last30)
        Returns:
            Clean DataFrame with proper columns and types, including status field
        """
        try:
            if not espn_data or 'players' not in espn_data:
                raise ValueError("Invalid ESPN players data structure")

            all_players = []
            for player_entry in espn_data.get('players', []):
                player = player_entry.get('player', {})
                status = player_entry.get('status', 'UNKNOWN')
                team_id = player_entry.get('onTeamId', 0)                

                player_name = player.get('fullName', 'Unknown')
                pro_team_id = player.get('proTeamId', 0)
                pro_team = PRO_TEAM_MAP.get(pro_team_id, 'Unknown')

                positions = "Unknown"
                if 'eligibleSlots' in player:
                    slots = [POSITION_MAP.get(slot, '') for slot in player['eligibleSlots'] if 0 <= slot <= 4]
                    positions = ", ".join(filter(None, slots)) or "Unknown"

                stats = player.get('stats', [])
                for stat in stats:
                    if stat.get('scoringPeriodId') == 0 and stat.get('statSplitTypeId') == stat_split_type_id and stat.get('seasonId') == settings.season_id:
                        player_stats = stat.get('stats', {})
                        mapped_stats = {
                            ESPN_COLUMN_MAP.get(key, key): value
                            for key, value in player_stats.items()
                            if key in ESPN_COLUMN_MAP
                        }

                        mapped_stats.update({
                            'Name': player_name,
                            'team_id': team_id,
                            'Pro Team': pro_team,
                            'Positions': positions,
                            'status': status
                        })

                        all_players.append(mapped_stats)
                        break

            if not all_players:
                raise ValueError("No valid player data found")

            df = pd.DataFrame(all_players)
            df = df.fillna(0)
            return self._organize_player_columns(df)

        except Exception as e:
            self.logger.error(f"Error transforming ESPN players data to DataFrame: {e}")
            raise Exception("Error transforming ESPN players data to DataFrame")

    def raw_players_to_df(self, espn_players_data: Dict, stat_split_type_id: int = 0) -> pd.DataFrame:
        """
        Convert raw ESPN API players data to DataFrame
        Args:
            espn_players_data: Raw ESPN API response
            stat_split_type_id: ESPN stat split type (0=season, 1=last7, 2=last15, 3=last30)
        Returns:
            Clean DataFrame with proper columns and types
        """
        try:
            if not espn_players_data or 'teams' not in espn_players_data:
                raise ValueError("Invalid ESPN players data structure")
            
            all_players = []
            for team in espn_players_data['teams']:
                team_id = team['id']
                if 'roster' in team and 'entries' in team['roster']:
                    for entry in team['roster']['entries']:
                        player_stats = self._extract_player_stats(entry, team_id, stat_split_type_id)
                        if player_stats:  # Only add if we got valid stats
                            all_players.append(player_stats)
            
            if not all_players:
                raise ValueError("No valid player data found")
            df = pd.DataFrame(all_players)
            df = df.fillna(0)
            return self._organize_player_columns(df)
            
        except Exception as e:
            self.logger.error(f"Error transforming ESPN players data to DataFrame: {e}")
            raise Exception("Error transforming ESPN players data to DataFrame")

    def raw_standings_to_totals_df(self, espn_standings_data: Dict) -> pd.DataFrame:
        """
        Convert raw ESPN API standings data to totals DataFrame
        Args:
            espn_standings_data: Raw ESPN API response
        Returns:
            Clean totals DataFrame with proper columns and types
        """
        try:
            if not espn_standings_data or 'teams' not in espn_standings_data:
                raise ValueError("Invalid ESPN standings data structure")
            
            # Extract team data from ESPN response
            teams_data = []
            for team in espn_standings_data['teams']:
                if 'id' in team and 'name' in team and 'valuesByStat' in team:
                    team_data = {
                        "team_id": team['id'], 
                        "team_name": team['name'].strip(), 
                        **team['valuesByStat']
                    }
                    teams_data.append(team_data)
            
            if not teams_data:
                raise ValueError("No valid team data found")
                
            df = pd.DataFrame(teams_data)
            return self._transform_standings_dataframe(df)
            
        except Exception as e:
            self.logger.error(f"Error transforming ESPN standings data to totals DataFrame: {e}")
            raise Exception("Error transforming ESPN standings data to totals DataFrame")
    
    def totals_to_averages_df(self, totals_df: pd.DataFrame) -> pd.DataFrame:
        """
        Calculate per-game averages from totals DataFrame
        Args:
            totals_df: DataFrame with total stats
        Returns:
            DataFrame with per-game averages
        """
        return self.stats_calculator.calculate_per_game_averages(totals_df)
    
    def averages_to_rankings_df(self, averages_df: pd.DataFrame) -> pd.DataFrame:
        """
        Calculate rankings from averages DataFrame
        Args:
            averages_df: DataFrame with per-game averages
        Returns:
            DataFrame with rankings and total points
        """
        return self.stats_calculator.calculate_rankings(averages_df)
    
    def _extract_player_stats(self, entry: Dict, team_id: int, stat_split_type_id: int = 0) -> Dict:
        """Extract player stats from ESPN API data"""
        try:
            if 'playerPoolEntry' not in entry or 'player' not in entry['playerPoolEntry']:
                return {}

            player = entry['playerPoolEntry']['player']

            # Extract basic player info
            player_name = player.get('fullName', 'Unknown')
            pro_team_id = player.get('proTeamId', 0)
            pro_team = PRO_TEAM_MAP.get(pro_team_id, 'Unknown')

            # Extract positions
            positions = "Unknown"
            if 'eligibleSlots' in player:
                slots = [POSITION_MAP.get(slot, '') for slot in player['eligibleSlots'] if 0 <= slot <= 4]
                positions = ", ".join(filter(None, slots)) or "Unknown"

            # Extract stats
            stats = player.get('stats', [])
            for stat in stats:
                if stat.get('scoringPeriodId') == 0 and stat.get('statSplitTypeId') == stat_split_type_id and stat.get('seasonId') == settings.season_id:
                    player_stats = stat.get('stats', {})
                    # Map ESPN column names to our names
                    mapped_stats = {
                        ESPN_COLUMN_MAP.get(key, key): value 
                        for key, value in player_stats.items() 
                        if key in ESPN_COLUMN_MAP
                    }
                    
                    # Add player info
                    mapped_stats.update({
                        'Name': player_name,
                        'team_id': team_id,
                        'Pro Team': pro_team,
                        'Positions': positions
                    })
                    
                    return mapped_stats
            
            return {}
            
        except Exception as e:
            self.logger.warning(f"Error extracting player stats: {e}")
            return {}
    
    def _organize_player_columns(self, df: pd.DataFrame) -> pd.DataFrame:
        """Organize player DataFrame columns in logical order"""
        info_cols = ['Name', 'team_id', 'Pro Team', 'Positions', 'status']
        stat_cols = [col for col in df.columns if col not in info_cols]
        available_info_cols = [col for col in info_cols if col in df.columns]
        return df.reindex(columns=available_info_cols + stat_cols)
    
    def _transform_standings_dataframe(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Transform raw DataFrame with proper column names and types
        Args:
            df: Raw DataFrame from ESPN API
        Returns:
            Clean DataFrame with proper structure
        """
        # Apply column mapping
        df = df.rename(columns=ESPN_COLUMN_MAP)
        
        # Select only required columns
        available_cols = ['team_id', 'team_name'] + [col for col in ALL_CATEGORIES if col in df.columns]
        df = df[available_cols]
        
        # Convert integer columns
        int_cols = [col for col in INTEGER_COLUMNS if col in df.columns]
        df[int_cols] = df[int_cols].astype(int)
        
        return df

    