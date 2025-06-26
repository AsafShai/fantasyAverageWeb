import pandas as pd
from typing import Dict, Optional
from app.utils.constants import (
    ESPN_COLUMN_MAP, ALL_CATEGORIES, PER_GAME_CATEGORIES, INTEGER_COLUMNS
)


class DataTransformer:
    """Transforms raw ESPN data into clean pandas DataFrames"""
    
    def raw_to_totals_df(self, espn_data: Dict) -> Optional[pd.DataFrame]:
        """
        Convert raw ESPN API data to totals DataFrame
        Args:
            espn_data: Raw ESPN API response
        Returns:
            Clean totals DataFrame with proper columns and types
        """
        try:
            # Extract team data from ESPN response
            teams_data = {team['name']: team['valuesByStat'] for team in espn_data['teams']}
            df = pd.DataFrame(teams_data).transpose()
            
            # Apply transformations
            df = self._transform_dataframe(df)
            return df
            
        except Exception as e:
            print(f"Error transforming ESPN data to totals DataFrame: {e}")
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
    
    def _transform_dataframe(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Transform raw DataFrame with proper column names and types
        Args:
            df: Raw DataFrame from ESPN API
        Returns:
            Clean DataFrame with proper structure
        """
        # Rename columns using ESPN mapping
        df = df.rename(columns=ESPN_COLUMN_MAP)
        
        # Select only the columns we need in the correct order
        df = df[ALL_CATEGORIES]
        
        # Convert integer columns to proper types
        df[INTEGER_COLUMNS] = df[INTEGER_COLUMNS].astype(int)
        
        # Set up proper indexing
        df.reset_index(inplace=True)
        df.rename(columns={'index': 'Team'}, inplace=True)
        df.set_index('Team', inplace=True)
        
        return df