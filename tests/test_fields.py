"""Pola zapisane na serwerze: kolejka workera, zmiana nazwy bez liczenia, odświeżanie raz na dobę (bez sieci)."""
from datetime import date, timedelta
from urllib.parse import parse_qs, urlsplit

import pytest
from pydantic import ValidationError

from app import fields
from app.core.crops import CROPS, daily_crop_arrays, last_completed_season, season_for_harvest_year, sowing_after
from app.report import satellite_endpoint
from app.schemas import FieldInput

PARCEL = "060910_2.0011.580/2"


@pytest.fixture(autouse=True)
def tmp_db(tmp_path, monkeypatch):
    monkeypatch.setattr(fields, "DB_PATH", tmp_path / "fields.sqlite3")
    monkeypatch.setattr(fields, "today_warsaw", lambda: date(2026, 11, 22))


def job(field_id):
    return next(f for f in fields.list_fields() if f.id == field_id)


def test_new_field_is_queued_with_default_name():
    saved = fields.save_field(FieldInput(parcel_id=PARCEL, crop="winter_wheat"))
    assert (saved.id, saved.name, saved.job, saved.report) == (PARCEL, "Działka 580/2", "queued", None)


def test_worker_result_rename_and_input_change():
    fields.save_field(FieldInput(parcel_id=PARCEL, crop="winter_wheat"))
    [row] = fields._claim(2)
    assert job(PARCEL).job == "running" and fields._claim(2) == []   # liczone pole nie jest brane drugi raz
    fields._finish(row, {"ok": 1}, None, "2026-11-22")
    assert job(PARCEL).job == "ok" and job(PARCEL).report == {"ok": 1}

    fields.save_field(FieldInput(name="Pod lasem", parcel_id=PARCEL, crop="winter_wheat"), PARCEL)
    assert job(PARCEL).name == "Pod lasem" and job(PARCEL).job == "ok"    # sama nazwa: bez liczenia

    fields.save_field(FieldInput(name="Pod lasem", parcel_id=PARCEL, crop="maize"), PARCEL)
    assert job(PARCEL).job == "queued" and job(PARCEL).report is None     # inna uprawa: stary raport znika


def test_result_of_outdated_input_is_dropped():
    fields.save_field(FieldInput(parcel_id=PARCEL, crop="winter_wheat"))
    [row] = fields._claim(1)
    fields.save_field(FieldInput(parcel_id=PARCEL, crop="maize"))   # zmiana w trakcie liczenia
    fields._finish(row, {"stary": 1}, None, "2026-11-22")
    assert job(PARCEL).job == "queued" and job(PARCEL).report is None


def test_daily_refresh_and_error_retry(monkeypatch):
    fields.save_field(FieldInput(parcel_id=PARCEL, crop="winter_wheat"))
    [row] = fields._claim(1)
    fields._finish(row, {"ok": 1}, None, "2026-11-22")
    assert fields._claim(1) == []                                    # dzisiejszy raport: nic do roboty
    monkeypatch.setattr(fields, "today_warsaw", lambda: date(2026, 11, 23))
    [row] = fields._claim(1)                                         # nowy dzień: odświeżenie
    fields._finish(row, None, "usługa nie odpowiedziała", "2026-11-23")
    saved = job(PARCEL)
    assert saved.job == "error" and saved.report == {"ok": 1}        # ostatni dobry raport zostaje
    assert fields._claim(1) == []                                    # ponowienie dopiero po RETRY_S


def test_parcel_change_replaces_old_field_and_delete():
    fields.save_field(FieldInput(parcel_id=PARCEL, crop="winter_wheat"))
    other = "060910_2.0011.581"
    fields.save_field(FieldInput(parcel_id=other, crop="winter_wheat"), PARCEL)
    assert [f.id for f in fields.list_fields()] == [other]
    assert fields.delete_field(other) and fields.list_fields() == []


def test_timeline_requeues_legacy_field_and_changes_only_the_selected_season():
    fields.save_field(FieldInput(parcel_id=PARCEL, crop="winter_wheat"))
    with fields._db() as con:
        con.execute("UPDATE fields SET input = ?", ('{"parcel_id":"060910_2.0011.580/2","crop":"winter_wheat"}',))
    [legacy] = fields._claim(1)
    fields._finish(legacy, {"ok": 1}, None, "2026-11-22")
    fields.save_field(FieldInput(name="Pod lasem", parcel_id=PARCEL, crop="winter_wheat"), PARCEL)
    assert job(PARCEL).job == "ok"

    sowing, harvest, next_sowing = date(2025, 10, 10), date(2026, 7, 20), date(2026, 9, 12)
    fields.save_field(FieldInput(parcel_id=PARCEL, crop="winter_wheat", sowing_date=sowing,
                                 harvest_date=harvest, next_sowing_date=next_sowing), PARCEL)
    saved = job(PARCEL)
    assert saved.job == "queued" and saved.report is None
    request = fields.report_request(saved.input)
    crop = request.crop_with_timeline()
    default = CROPS["winter_wheat"]
    season = last_completed_season(crop, date(2026, 8, 1))
    assert season.sowing == sowing and season.harvest == harvest + timedelta(days=1)
    assert season_for_harvest_year(crop, 2025) == season_for_harvest_year(default, 2025)
    assert sowing_after(crop, season) == next_sowing
    days = [sowing - timedelta(days=1), sowing]
    assert daily_crop_arrays(crop, days).stage == ["off_season", "initial"]
    query = parse_qs(urlsplit(satellite_endpoint(request, PARCEL)).query)
    assert query["sowing_date"] == [sowing.isoformat()]
    assert query["harvest_date"] == [harvest.isoformat()]
    assert query["next_sowing_date"] == [next_sowing.isoformat()]


def test_timeline_rejects_inverted_dates():
    with pytest.raises(ValidationError, match="Zbiór musi przypadać po siewie"):
        FieldInput(parcel_id=PARCEL, crop="maize", sowing_date=date(2026, 5, 1), harvest_date=date(2026, 4, 1))
