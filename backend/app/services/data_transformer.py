import pandas as pd
import logging
from typing import Dict, Optional
from app.utils.constants import (
    ESPN_COLUMN_MAP, ALL_CATEGORIES, PER_GAME_CATEGORIES, INTEGER_COLUMNS, PRO_TEAM_MAP, POSITION_MAP
)


class DataTransformer:
    """Transforms raw ESPN data into clean pandas DataFrames"""
    
    def __init__(self):
        self.logger = logging.getLogger(__name__)
    
    def raw_players_to_df(self, espn_players_data: Dict, teams_mapping: Dict) -> Optional[pd.DataFrame]:
        """
        Convert raw ESPN API players data to totals DataFrame
        Args:
            espn_players_data: Raw ESPN API response
            teams_mapping: Mapping of team names to their IDs
        Returns:
            Clean totals DataFrame with proper columns and types
        """
        try:
            all_players = []
            for team in espn_players_data['teams']:
                team_id = team['id']
                for entry in team['roster']['entries']:
                    all_players.append(self._get_player_stats(entry, team_id))
            df = pd.DataFrame(all_players)
            df['Team'] = df['Team'].replace(teams_mapping)
            stat_columns = [col for col in df.columns if col not in ['Team', 'Name', 'Pro Team', 'Positions']]
            df = df.reindex(columns=['Name', 'Team', 'Pro Team', 'Positions'] + stat_columns)
            return df
        except Exception as e:
            self.logger.error(f"Error transforming ESPN players data to DataFrame: {e}")
            return None

    def _get_player_stats(self, entry: Dict, team_id: int) -> Dict:
        """
        Get player stats from ESPN API data
        Args:
            entry: Raw ESPN API response
        Returns:
            Clean player stats DataFrame with proper columns and types
        """
        player_name = entry['playerPoolEntry']['player']['fullName']
        pro_teamId = entry['playerPoolEntry']['player']['proTeamId']
        proTeam = PRO_TEAM_MAP[pro_teamId]
        stats = entry['playerPoolEntry']['player']['stats']
        if 'eligibleSlots' in entry['playerPoolEntry']['player']:
            slots = ", ".join([POSITION_MAP[slot] for slot in entry['playerPoolEntry']['player']['eligibleSlots'] if 0 <= slot <= 4])
        for stat in stats:
            if stat['scoringPeriodId'] != 0 and stat['statSplitTypeId'] != 0:
                continue
            player_stats = stat['stats']
            player_stats = {ESPN_COLUMN_MAP[key]: value for key, value in player_stats.items() if key in ESPN_COLUMN_MAP}
            player_stats['Name'] = player_name
            player_stats['Team'] = team_id
            player_stats['Pro Team'] = proTeam
            player_stats['Positions'] = slots
            return player_stats
        return {}

    def raw_standings_to_totals_df(self, espn_standings_data: Dict) -> Optional[pd.DataFrame]:
        """
        Convert raw ESPN API standings data to totals DataFrame
        Args:
            espn_data: Raw ESPN API response
        Returns:
            Clean totals DataFrame with proper columns and types
        """
        try:
            # Extract team data from ESPN response
            teams_data = {team['name'].strip(): team['valuesByStat'] for team in espn_standings_data['teams']}
            df = pd.DataFrame(teams_data).transpose()
            
            # Apply transformations
            df = self._transform_standings_dataframe(df)
            return df
            
        except Exception as e:
            self.logger.error(f"Error transforming ESPN standings data to totals DataFrame: {e}")
            return None
    
    def totals_to_averages_df(self, totals_df: pd.DataFrame) -> pd.DataFrame:
        """
        Calculate per-game averages from totals DataFrame
        Args:
            totals_df: DataFrame with total stats
        Returns:
            DataFrame with per-game averages
        """
        # Create copy without raw counting stats (keep percentages)
        averages = totals_df.drop(['FGM', 'FGA', 'FTM', 'FTA'], axis=1).copy()
        
        # Calculate per-game averages for counting stats
        averages[PER_GAME_CATEGORIES] = averages[PER_GAME_CATEGORIES].div(averages['GP'], axis=0)
        
        return averages.round(4)
    
    def averages_to_rankings_df(self, averages_df: pd.DataFrame) -> pd.DataFrame:
        """
        Calculate rankings from averages DataFrame
        Args:
            averages_df: DataFrame with per-game averages
        Returns:
            DataFrame with rankings and total points
        """
        ranked = averages_df.copy()
        ranked.drop(['GP'], axis=1, inplace=True)
        
        ranked = ranked.rank()
        
        ranked['Total_Points'] = ranked.sum(axis=1)
        
        ranked.sort_values(by='Total_Points', ascending=False, inplace=True)
    
        ranked['Rank'] = ranked['Total_Points'].rank(method='min', ascending=False).astype(int)
        ranked.reset_index(inplace=True)
        
        return ranked
    
    def _transform_standings_dataframe(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Transform raw DataFrame with proper column names and types
        Args:
            df: Raw DataFrame from ESPN API
        Returns:
            Clean DataFrame with proper structure
        """
        # Rename columns using ESPN mapping
        df = df.rename(columns=ESPN_COLUMN_MAP)

        df = df.loc[:, ALL_CATEGORIES]
        
        # Convert integer columns to proper types
        df[INTEGER_COLUMNS] = df[INTEGER_COLUMNS].astype(int)
        
        # Set up proper indexing
        df.reset_index(inplace=True)
        df.rename(columns={'index': 'Team'}, inplace=True)
        df.set_index('Team', inplace=True)
        
        return df

    