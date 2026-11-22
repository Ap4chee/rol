"""Pola zapisane na serwerze: kolejka workera, zmiana nazwy bez liczenia, odświeżanie raz na dobę (bez sieci)."""
import asyncio
import sqlite3
from datetime import date, timedelta
from urllib.parse import parse_qs, urlsplit

import pytest
from pydantic import ValidationError

from app.core.crops import CROPS, daily_crop_arrays, last_completed_season, season_for_harvest_year, sowing_after
from app.persistence.field_repository import FieldRepository
from app.presentation.sections.satellite import satellite_endpoint
from app.schemas import FieldInput
from app.services.field_worker import RETRY_S, FieldWorker, report_request

PARCEL = "060910_2.0011.580/2"
TODAY = "2026-11-22"
NOW = 1_000_000.0


@pytest.fixture
def repo(tmp_path):
    return FieldRepository(tmp_path / "fields.sqlite3")


@pytest.fixture
def worker(repo):
    return FieldWorker(repo, builder=None, today=lambda: date(2026, 11, 22))


def save(worker, inp, previous_id=None):
    return asyncio.run(worker.save_field(inp, previous_id))


def job(worker, field_id):
    return next(f for f in asyncio.run(worker.list_fields()) if f.id == field_id)


def test_new_field_is_queued_with_default_name(worker):
    saved = save(worker, FieldInput(parcel_id=PARCEL, crop="winter_wheat"))
    assert (saved.id, saved.name, saved.job, saved.report) == (PARCEL, "Działka 580/2", "queued", None)


def test_worker_result_rename_and_input_change(worker, repo):
    save(worker, FieldInput(parcel_id=PARCEL, crop="winter_wheat"))
    [row] = repo.claim(2, TODAY, NOW)
    assert job(worker, PARCEL).job == "running" and repo.claim(2, TODAY, NOW) == []   # liczone pole nie jest brane drugi raz
    repo.finish_ok(row, {"ok": 1}, TODAY, NOW)
    assert job(worker, PARCEL).job == "ok" and job(worker, PARCEL).report == {"ok": 1}

    save(worker, FieldInput(name="Pod lasem", parcel_id=PARCEL, crop="winter_wheat"), PARCEL)
    assert job(worker, PARCEL).name == "Pod lasem" and job(worker, PARCEL).job == "ok"    # sama nazwa: bez liczenia

    save(worker, FieldInput(name="Pod lasem", parcel_id=PARCEL, crop="maize"), PARCEL)
    assert job(worker, PARCEL).job == "queued" and job(worker, PARCEL).report is None     # inna uprawa: stary raport znika


def test_result_of_outdated_input_is_dropped(worker, repo):
    save(worker, FieldInput(parcel_id=PARCEL, crop="winter_wheat"))
    [row] = repo.claim(1, TODAY, NOW)
    save(worker, FieldInput(parcel_id=PARCEL, crop="maize"))   # zmiana w trakcie liczenia
    repo.finish_ok(row, {"stary": 1}, TODAY, NOW)
    assert job(worker, PARCEL).job == "queued" and job(worker, PARCEL).report is None


def test_daily_refresh_and_error_retry(worker, repo):
    save(worker, FieldInput(parcel_id=PARCEL, crop="winter_wheat"))
    [row] = repo.claim(1, TODAY, NOW)
    repo.finish_ok(row, {"ok": 1}, TODAY, NOW)
    assert repo.claim(1, TODAY, NOW) == []                           # dzisiejszy raport: nic do roboty
    [row] = repo.claim(1, "2026-11-23", NOW)                         # nowy dzień: odświeżenie
    repo.finish_error(row, "usługa nie odpowiedziała", NOW + RETRY_S)
    saved = job(worker, PARCEL)
    assert saved.job == "error" and saved.report == {"ok": 1}        # ostatni dobry raport zostaje
    assert repo.claim(1, "2026-11-23", NOW) == []                    # ponowienie dopiero po RETRY_S
    assert len(repo.claim(1, "2026-11-23", NOW + RETRY_S)) == 1


def test_parcel_change_replaces_old_field_and_delete(worker):
    save(worker, FieldInput(parcel_id=PARCEL, crop="winter_wheat"))
    other = "060910_2.0011.581"
    save(worker, FieldInput(parcel_id=other, crop="winter_wheat"), PARCEL)
    assert [f.id for f in asyncio.run(worker.list_fields())] == [other]
    assert asyncio.run(worker.delete_field(other)) and asyncio.run(worker.list_fields()) == []


def test_requeue_after_restart(worker, repo):
    save(worker, FieldInput(parcel_id=PARCEL, crop="winter_wheat"))
    repo.claim(1, TODAY, NOW)
    repo.requeue_running()
    assert job(worker, PARCEL).job == "queued"


def test_timeline_requeues_legacy_field_and_changes_only_the_selected_season(worker, repo, tmp_path):
    save(worker, FieldInput(parcel_id=PARCEL, crop="winter_wheat"))
    with sqlite3.connect(tmp_path / "fields.sqlite3") as con:
        con.execute("UPDATE fields SET input = ?", ('{"parcel_id":"060910_2.0011.580/2","crop":"winter_wheat"}',))
    [legacy] = repo.claim(1, TODAY, NOW)
    repo.finish_ok(legacy, {"ok": 1}, TODAY, NOW)
    save(worker, FieldInput(name="Pod lasem", parcel_id=PARCEL, crop="winter_wheat"), PARCEL)
    assert job(worker, PARCEL).job == "ok"

    sowing, harvest, next_sowing = date(2025, 10, 10), date(2026, 7, 20), date(2026, 9, 12)
    save(worker, FieldInput(parcel_id=PARCEL, crop="winter_wheat", sowing_date=sowing,
                            harvest_date=harvest, next_sowing_date=next_sowing), PARCEL)
    saved = job(worker, PARCEL)
    assert saved.job == "queued" and saved.report is None
    request = report_request(saved.input, date(2026, 11, 22))
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
