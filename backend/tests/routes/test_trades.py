import pytest
from fastapi.testclient import TestClient
from unittest.mock import AsyncMock
from app.main import app
from app.models import TradeSuggestionsResponse, TradeSuggestion, Team, Player, PlayerStats
from app.exceptions import ResourceNotFoundError, DataSourceError
from app.services.trades_service import get_trades_service

@pytest.fixture
def mock_trades_service():
    """Create a fresh mock service for each test"""
    mock = AsyncMock()
    
    # Override the dependency for this test
    app.dependency_overrides[get_trades_service] = lambda: mock
    
    yield mock
    
    if get_trades_service in app.dependency_overrides:
        del app.dependency_overrides[get_trades_service]

client = TestClient(app)

class TestTradesRoutes:
    """Test suite for trades API routes"""

    def test_get_trades_suggestions_success(self, test_client, mock_trades_service):
        """Test successful trade suggestions retrieval"""
        team_id = 1
    
        user_team = Team(team_id=1, team_name="Team Alpha")
        opponent_team = Team(team_id=2, team_name="Team Beta")
    
        player_stats = PlayerStats(
            pts=20.5, reb=8.0, ast=6.0, stl=1.5, blk=0.8,
            fgm=8.0, fga=16.0, ftm=3.0, fta=4.0,
            fg_percentage=50.0, ft_percentage=75.0, three_pm=2.5, gp=75
        )
        
        player_to_give = Player(
            player_name="LeBron James",
            pro_team="LAL", 
            positions=["SF", "PF"],
            stats=player_stats
        )
        
        player_to_receive = Player(
            player_name="Stephen Curry",
            pro_team="GSW",
            positions=["PG"],
            stats=player_stats
        )
        
        trade_suggestion = TradeSuggestion(
            opponent_team=opponent_team,
            players_to_give=[player_to_give],
            players_to_receive=[player_to_receive],
            reasoning="This trade improves your 3-point shooting while maintaining overall scoring"
        )
        
        mock_response = TradeSuggestionsResponse(
            user_team=user_team,
            trade_suggestions=[trade_suggestion]
        )
        
        mock_trades_service.get_trades_suggestions_by_team_id.return_value = mock_response
        
        response = test_client.get(f"/api/trades/suggestions/{team_id}")
        
        assert response.status_code == 200
        mock_trades_service.get_trades_suggestions_by_team_id.assert_called_once_with(team_id)

    def test_get_trades_suggestions_invalid_team_id_zero(self, test_client, mock_trades_service):
        """Test trade suggestions with team_id = 0 (should pass to service and return 404)"""
        team_id = 0
        mock_trades_service.get_trades_suggestions_by_team_id.side_effect = ResourceNotFoundError("Team not found")
        
        response = test_client.get(f"/api/trades/suggestions/{team_id}")
        
        assert response.status_code == 404
        assert "Team not found" in response.json()["detail"]

    def test_get_trades_suggestions_invalid_team_id_negative(self, test_client):
        """Test trade suggestions with negative team_id"""
        team_id = -1
        response = test_client.get(f"/api/trades/suggestions/{team_id}")
        
        assert response.status_code == 400
        assert "Team ID must be positive" in response.json()["detail"]

    def test_get_trades_suggestions_team_not_found(self, test_client, mock_trades_service):
        """Test trade suggestions when team is not found"""
        team_id = 999
        
        mock_trades_service.get_trades_suggestions_by_team_id.side_effect = ResourceNotFoundError("Team not found")
        
        response = test_client.get(f"/api/trades/suggestions/{team_id}")
        
        assert response.status_code == 404
        assert "Team not found" in response.json()["detail"]

    def test_get_trades_suggestions_data_source_error(self, test_client, mock_trades_service):
        """Test trade suggestions when external data source is unavailable"""
        team_id = 1
        
        mock_trades_service.get_trades_suggestions_by_team_id.side_effect = DataSourceError("ESPN API unavailable")
        
        response = test_client.get(f"/api/trades/suggestions/{team_id}")
        
        assert response.status_code == 503
        assert "External data source unavailable" in response.json()["detail"]

    def test_get_trades_suggestions_internal_server_error(self, test_client, mock_trades_service):
        """Test trade suggestions when unexpected error occurs"""
        team_id = 1
        
        mock_trades_service.get_trades_suggestions_by_team_id.side_effect = Exception("Unexpected error")
        
        response = test_client.get(f"/api/trades/suggestions/{team_id}")
        
        assert response.status_code == 500
        assert "Internal server error" in response.json()["detail"]

    def test_get_trades_suggestions_rate_limiting(self, test_client, mock_trades_service):
        """Test that rate limiting is enforced on trades endpoint"""
        team_id = 2  # Use different team ID to avoid interference
        
        user_team = Team(team_id=2, team_name="Team Beta")
        mock_response = TradeSuggestionsResponse(
            user_team=user_team,
            trade_suggestions=[]
        )
        mock_trades_service.get_trades_suggestions_by_team_id.return_value = mock_response
        
        responses = []
        for i in range(6):
            response = test_client.get(f"/api/trades/suggestions/{team_id}")
            responses.append(response)
        
        successful_requests = sum(1 for r in responses if r.status_code == 200)
        rate_limited_requests = sum(1 for r in responses if r.status_code == 429)
        
        assert successful_requests >= 4  # Allow some flexibility
        assert rate_limited_requests >= 1  

    def test_get_trades_suggestions_response_structure(self, test_client, mock_trades_service):
        """Test that the response has the correct structure"""
        team_id = 3
        
        user_team = Team(team_id=3, team_name="Team Gamma")
        opponent_team = Team(team_id=4, team_name="Team Delta")
        
        player_stats = PlayerStats(
            pts=25.0, reb=6.0, ast=8.0, stl=2.0, blk=1.0,
            fgm=9.0, fga=18.0, ftm=4.0, fta=5.0,
            fg_percentage=50.0, ft_percentage=80.0, three_pm=3.0, gp=70
        )
        
        player_to_give = Player(
            player_name="Kevin Durant",
            pro_team="PHO",
            positions=["SF", "PF"],
            stats=player_stats
        )
        
        player_to_receive = Player(
            player_name="Jayson Tatum",
            pro_team="BOS", 
            positions=["SF", "PF"],
            stats=player_stats
        )
        
        trade_suggestion = TradeSuggestion(
            opponent_team=opponent_team,
            players_to_give=[player_to_give],
            players_to_receive=[player_to_receive],
            reasoning="This trade provides better defensive versatility"
        )
        
        mock_response = TradeSuggestionsResponse(
            user_team=user_team,
            trade_suggestions=[trade_suggestion]
        )
        
        mock_trades_service.get_trades_suggestions_by_team_id.return_value = mock_response
        
        response = test_client.get(f"/api/trades/suggestions/{team_id}")
        
        assert response.status_code == 200
        data = response.json()
        
        assert "user_team" in data
        assert "trade_suggestions" in data
        assert data["user_team"]["team_id"] == team_id
        assert isinstance(data["trade_suggestions"], list)
        assert len(data["trade_suggestions"]) == 1