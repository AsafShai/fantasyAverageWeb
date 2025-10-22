import os
import pytest
import pytest_asyncio
from fastapi.testclient import TestClient
from httpx import AsyncClient
from unittest.mock import AsyncMock, patch, MagicMock
import asyncio

# Mock environment variables for testing
os.environ.update({
    "SEASON_ID": "2026",
    "LEAGUE_ID": "1234567890",
    "CORS_ORIGINS": "http://localhost:3000,http://localhost:5173",
    "ENVIRONMENT": "test",
    "LOG_LEVEL": "WARNING",
    "PORT": "8000"
})

# Import after setting environment variables
from app.main import app
from app.services.data_provider import DataProvider

@pytest.fixture(scope="session")
def event_loop():
    """Create an instance of the default event loop for the test session."""
    policy = asyncio.get_event_loop_policy()
    loop = policy.new_event_loop()
    yield loop
    loop.close()

# Create a mock DataProvider class that behaves properly with the singleton pattern
class MockDataProvider:
    """Mock DataProvider that doesn't interfere with singleton pattern."""
    
    def __init__(self):
        import pandas as pd
        
        # Sample DataFrames that match the expected structure
        self.sample_totals_df = pd.DataFrame({
            'team_id': [1, 2, 3],
            'team_name': ['Team Alpha', 'Team Beta', 'Team Gamma'],
            'FGM': [3842, 3756, 3699],
            'FGA': [8234, 8456, 8123], 
            'FG%': [46.7, 44.4, 45.5],
            'FTM': [1523, 1645, 1456],
            'FTA': [2034, 2156, 1923],
            'FT%': [74.9, 76.3, 75.7],
            '3PM': [1245, 1367, 1123],
            'AST': [2345, 2267, 2456],
            'REB': [3567, 3423, 3678],
            'STL': [756, 689, 823],
            'BLK': [456, 534, 423],
            'PTS': [9452, 9924, 8977],
            'GP': [82, 82, 82]
        })
        
        self.sample_averages_df = pd.DataFrame({
            'team_id': [1, 2, 3],
            'team_name': ['Team Alpha', 'Team Beta', 'Team Gamma'],
            'FG%': [46.7, 44.4, 45.5],
            'FT%': [74.9, 76.3, 75.7],
            '3PM': [15.2, 16.7, 13.7],
            'AST': [28.6, 27.6, 30.0],
            'REB': [43.5, 41.7, 44.9],
            'STL': [9.2, 8.4, 10.0],
            'BLK': [5.6, 6.5, 5.2],
            'PTS': [115.3, 121.0, 109.5],
            'GP': [82, 82, 82]
        })
        
        self.sample_rankings_df = pd.DataFrame({
            'team_id': [1, 2, 3],
            'team_name': ['Team Alpha', 'Team Beta', 'Team Gamma'],
            'FG%': [2, 3, 1],
            'FT%': [3, 1, 2],
            '3PM': [2, 1, 3],
            'AST': [2, 3, 1],
            'REB': [2, 3, 1],
            'STL': [2, 3, 1],
            'BLK': [3, 1, 2],
            'PTS': [2, 1, 3],
            'TOTAL_POINTS': [18, 17, 15],
            'RANK': [1, 2, 3],
            'GP': [82, 82, 82]
        })
        
        self.sample_players_df = pd.DataFrame({
            'team_id': [1, 1, 2, 2, 3, 3],
            'player_id': [101, 102, 201, 202, 301, 302],
            'Name': ['Player A1', 'Player A2', 'Player B1', 'Player B2', 'Player C1', 'Player C2'],
            'Pro Team': ['Team Alpha', 'Team Alpha', 'Team Beta', 'Team Beta', 'Team Gamma', 'Team Gamma'],
            'Positions': ['PG', 'SF', 'SG', 'PF', 'C', 'SF'],
            'PTS': [20.5, 18.2, 22.1, 16.8, 19.5, 15.2],
            'REB': [5.2, 7.8, 4.1, 9.2, 11.5, 6.3],
            'AST': [8.1, 3.2, 6.5, 2.8, 2.1, 4.7],
            'STL': [1.2, 0.8, 1.5, 0.9, 0.7, 1.1],
            'BLK': [0.5, 2.1, 0.3, 1.8, 2.5, 0.6],
            'FGM': [8.2, 6.9, 9.1, 6.4, 7.8, 5.9],
            'FGA': [17.5, 14.2, 19.8, 13.6, 16.1, 12.7],
            'FTM': [3.1, 2.4, 3.8, 2.1, 2.9, 2.0],
            'FTA': [3.8, 3.0, 4.5, 2.6, 3.6, 2.5],
            'FG%': [46.9, 48.6, 46.0, 47.1, 48.4, 46.5],
            'FT%': [81.6, 80.0, 84.4, 80.8, 80.6, 80.0],
            '3PM': [2.8, 1.2, 3.4, 0.8, 0.9, 1.6],
            'GP': [72, 68, 75, 70, 74, 69],
            'MIN': [28.5, 27.4, 30.1, 26.8, 29.6, 27.8]
        })
    
    async def get_totals_df(self):
        return self.sample_totals_df
    
    async def get_averages_df(self):
        return self.sample_averages_df
    
    async def get_rankings_df(self):
        return self.sample_rankings_df
    
    async def get_players_df(self):
        return self.sample_players_df
    
    async def get_all_dataframes(self):
        return (self.sample_totals_df, self.sample_averages_df, self.sample_rankings_df)
    
    async def close(self):
        pass

@pytest.fixture(scope="session", autouse=True)
def mock_data_provider_globally():
    """Mock the DataProvider globally for all tests to avoid HTTP client issues."""
    mock_provider = MockDataProvider()
    
    # Mock the original DataProvider class methods to avoid HTTP calls
    with patch.object(DataProvider, '__new__', return_value=mock_provider), \
         patch.object(DataProvider, '__init__', return_value=None), \
         patch('app.services.data_provider.get_data_provider', return_value=mock_provider):
        yield mock_provider

@pytest.fixture
def test_client():
    """Create a test client for the FastAPI application."""
    with TestClient(app) as client:
        yield client

@pytest_asyncio.fixture
async def async_client():
    """Create an async test client for the FastAPI application."""
    async with AsyncClient(app=app, base_url="http://test") as ac:
        yield ac


# Shared DataFrame fixtures - consolidated from individual test files
@pytest.fixture
def sample_totals_df():
    """Sample totals DataFrame for testing - matches ESPN data structure"""
    import pandas as pd
    return pd.DataFrame({
        'team_id': [1, 2, 3],
        'team_name': ['Team Alpha', 'Team Beta', 'Team Gamma'],
        'FGM': [3842, 3756, 3699],
        'FGA': [8234, 8456, 8123], 
        'FG%': [46.7, 44.4, 45.5],
        'FTM': [1523, 1645, 1456],
        'FTA': [2034, 2156, 1923],
        'FT%': [74.9, 76.3, 75.7],
        '3PM': [1245, 1367, 1123],
        'AST': [2345, 2267, 2456],
        'REB': [3567, 3423, 3678],
        'STL': [756, 689, 823],
        'BLK': [456, 534, 423],
        'PTS': [9452, 9924, 8977],
        'GP': [82, 82, 82]
    })

@pytest.fixture
def sample_averages_df():
    """Sample averages DataFrame for testing - matches per-game structure"""
    import pandas as pd
    return pd.DataFrame({
        'team_id': [1, 2, 3],
        'team_name': ['Team Alpha', 'Team Beta', 'Team Gamma'],
        'FG%': [46.7, 44.4, 45.5],
        'FT%': [74.9, 76.3, 75.7],
        '3PM': [15.2, 16.7, 13.7],
        'AST': [28.6, 27.6, 30.0],
        'REB': [43.5, 41.7, 44.9],
        'STL': [9.2, 8.4, 10.0],
        'BLK': [5.6, 6.5, 5.2],
        'PTS': [115.3, 121.0, 109.5],
        'GP': [82, 82, 82]
    })

@pytest.fixture
def sample_rankings_df():
    """Sample rankings DataFrame for testing - matches ranking structure"""
    import pandas as pd
    return pd.DataFrame({
        'team_id': [1, 2, 3],
        'team_name': ['Team Alpha', 'Team Beta', 'Team Gamma'],
        'FG%': [2, 3, 1],
        'FT%': [3, 1, 2],
        '3PM': [2, 1, 3],
        'AST': [2, 3, 1],
        'REB': [2, 3, 1],
        'STL': [2, 3, 1],
        'BLK': [3, 1, 2],
        'PTS': [2, 1, 3],
        'TOTAL_POINTS': [18, 17, 15],
        'RANK': [1, 2, 3],
        'GP': [82, 82, 82]
    })

@pytest.fixture
def sample_stats_calculator_averages_df():
    """Sample averages DataFrame for stats calculator testing - values create distinct rankings"""
    import pandas as pd
    return pd.DataFrame({
        'team_id': [1, 2, 3],
        'team_name': ['Team Alpha', 'Team Beta', 'Team Gamma'],
        'FG%': [48.0, 44.0, 46.0],   
        'FT%': [76.0, 78.0, 74.0],   
        '3PM': [16.0, 18.0, 14.0],   
        'AST': [30.0, 26.0, 28.0],   
        'REB': [45.0, 40.0, 42.0],   
        'STL': [10.0, 8.0, 9.0],     
        'BLK': [6.0, 7.0, 5.0],      
        'PTS': [118.0, 122.0, 115.0],
        'GP': [82, 82, 82]
    })
