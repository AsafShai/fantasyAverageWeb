from unittest.mock import patch

from app.models.injury_models import InjuryNotification, InjuryRecord


def _sample_record(key_suffix: str = "1") -> InjuryRecord:
    return InjuryRecord(
        game=f"g{key_suffix}",
        team=f"t{key_suffix}",
        player=f"p{key_suffix}",
        status="Out",
        injury="knee",
        last_update="2025-01-01T00:00:00Z",
    )


@patch("app.routes.injuries.injury_service.injury_store", {"a": _sample_record()})
def test_get_injuries_returns_records(test_client):
    response = test_client.get("/api/injuries/")
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 1
    assert data[0]["player"] == "p1"


@patch("app.routes.injuries.injury_service.injury_store", {})
def test_get_injuries_empty_store(test_client):
    response = test_client.get("/api/injuries/")
    assert response.status_code == 200
    assert response.json() == []


@patch(
    "app.routes.injuries.injury_service.notification_history",
    [
        InjuryNotification(
            type="added",
            player="X",
            team="Y",
            new_status="Out",
            timestamp="2025-01-01T00:00:00Z",
        )
    ],
)
def test_get_notifications(test_client):
    response = test_client.get("/api/injuries/notifications")
    assert response.status_code == 200
    assert response.json()[0]["player"] == "X"


@patch("app.routes.injuries.injury_service.notification_history", [])
def test_get_notifications_empty(test_client):
    response = test_client.get("/api/injuries/notifications")
    assert response.status_code == 200
    assert response.json() == []


@patch("app.routes.injuries.injury_service.last_report_time", "2025-02-02T12:00:00Z")
def test_get_status(test_client):
    response = test_client.get("/api/injuries/status")
    assert response.status_code == 200
    assert response.json() == {"last_report_time": "2025-02-02T12:00:00Z"}
