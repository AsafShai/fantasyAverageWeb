from app.models import HeatmapData

def test_get_heatmap(test_client):
    """Test that the heatmap is returned correctly"""
    response = test_client.get("/api/analytics/heatmap")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(HeatmapData(**data), HeatmapData), f"Response is not a HeatmapData object: {data}"


