"""Routery przez TestClient: kody HTTP, walidacja parametrów i mapowanie błędów domenowych (bez sieci)."""
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient

from app.api import deps
from app.core.dates import today_warsaw
from app.main import create_app
from app.services.errors import ParcelNotFound, ParcelSourceDown
from app.services.report_builder import ReportBuilder
from tests.services.test_report_builder import FakeGatherer

REPORT_BODY = {"point": {"lon": 22.5, "lat": 51.2}, "crop": "winter_wheat", "date": "2025-06-20"}


class FailingGatherer(FakeGatherer):
    def __init__(self, exc: Exception) -> None:
        super().__init__()
        self.exc = exc

    async def gather(self, *args, **kwargs):
        raise self.exc


@pytest.fixture
def app(tmp_path):
    # bez `with TestClient(...)` lifespan nie startuje, więc worker pól nic nie liczy w tle
    return create_app(data_dir=tmp_path)


@pytest.fixture
def client(app):
    app.dependency_overrides[deps.report_builder] = lambda: ReportBuilder(FakeGatherer())
    return TestClient(app)


def test_crops_lists_all_crops(client):
    crops = client.get("/api/crops").json()
    assert len(crops) == 7 and {"key": "maize", "name": "kukurydza"} in [
        {"key": c["key"], "name": c["name"].lower()} for c in crops]


def test_report_from_fake_sources(client):
    response = client.post("/api/report", json=REPORT_BODY)
    assert response.status_code == 200
    body = response.json()
    assert body["water_status"]["status"] == "ok" and body["parcel"] is None


def test_future_date_is_422_with_reason(client):
    future = (today_warsaw() + timedelta(days=2)).isoformat()
    response = client.post("/api/report", json={**REPORT_BODY, "date": future})
    assert response.status_code == 422
    assert response.json() == {"detail": "Data analizy nie może być z przyszłości."}


@pytest.mark.parametrize(("exc", "code"), [(ParcelNotFound("Nie ma takiej działki."), 404),
                                           (ParcelSourceDown("ULDK nie odpowiada."), 502)])
def test_parcel_errors_map_to_http_codes(app, exc, code):
    app.dependency_overrides[deps.report_builder] = lambda: ReportBuilder(FailingGatherer(exc))
    response = TestClient(app).post("/api/report", json=REPORT_BODY)
    assert response.status_code == code and response.json() == {"detail": str(exc)}


def test_fields_save_list_delete(client):
    body = {"parcel_id": "060910_2.0011.580/2", "crop": "winter_wheat"}
    saved = client.post("/api/fields", json=body).json()
    assert saved["job"] == "queued" and saved["name"] == "Działka 580/2"
    assert [f["id"] for f in client.get("/api/fields").json()] == [saved["id"]]
    assert client.delete("/api/fields", params={"id": saved["id"]}).json() == {"deleted": saved["id"]}
    assert client.delete("/api/fields", params={"id": saved["id"]}).status_code == 404


def test_field_with_too_old_date_is_rejected(client):
    response = client.post("/api/fields", json={"parcel_id": "060910_2.0011.580/2", "crop": "maize",
                                                "date": "2004-12-31"})
    assert response.status_code == 422


def test_coordinates_outside_poland_are_rejected(client):
    assert client.get("/api/forecast", params={"lon": 30.0, "lat": 52.0}).status_code == 422
    assert client.get("/api/parcels/by-point", params={"lon": 20.0, "lat": 60.0}).status_code == 422


def test_fieldwork_rejects_impossible_texture(client):
    response = client.get("/api/fieldwork", params={"lon": 22.5, "lat": 51.2, "crop": "maize", "sand": 70, "clay": 40})
    assert response.status_code == 422
