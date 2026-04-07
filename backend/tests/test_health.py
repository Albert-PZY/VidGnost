from fastapi.testclient import TestClient

from app.main import app


def test_health_ok() -> None:
    with TestClient(app) as client:
        response = client.get("/api/health")
        assert response.status_code == 200
        payload = response.json()
        assert payload["status"] == "ok"
        assert payload["app"] == "VidGnost API"
