from app.main import app
from app.models import HeatmapData
from fastapi.testclient import TestClient

client = TestClient(app)


def test_get_heatmap():
    """Test that the heatmap is returned correctly"""
    response = client.get("/api/analytics/heatmap")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(HeatmapData(**data), HeatmapData), f"Response is not a HeatmapData object: {data}"


