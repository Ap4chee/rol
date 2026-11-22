"""Pola rolnika zapisane na serwerze i worker, który liczy ich raporty w tle.

Raport liczy się zaraz po dodaniu pola (albo zmianie działki, uprawy lub daty), a potem raz na dobę według
czasu Europe/Warsaw. Pole bez daty analizuje zawsze dzisiejszy dzień, pole z datą historyczną tę datę.
Nieudane liczenie worker ponawia co RETRY_S, a ostatni dobry raport zostaje widoczny do tego czasu.
Worker działa w procesie serwera (start w `app.main`), więc serwer uruchamiamy jednym procesem uvicorn.
Dane w SQLite w DATA_DIR (nie w cache/, które wolno kasować).
"""
from __future__ import annotations

import asyncio
import json
import logging
import sqlite3
import time
from contextlib import contextmanager
from datetime import datetime, timezone

from fastapi import HTTPException

from app.config import DATA_DIR, SATELLITE_DEFERRED_BUDGET_S
from app.report import build_report, today_warsaw
from app.schemas import FieldInput, ReportRequest, SavedField, Status

log = logging.getLogger(__name__)

DB_PATH = DATA_DIR / "fields.sqlite3"
WORKERS = 2            # tyle raportów naraz; każdy i tak pobiera swoje źródła równolegle
CHECK_EVERY_S = 60.0   # jak często worker sprawdza, czy nadszedł nowy dzień albo pora ponowienia
RETRY_S = 15 * 60.0
SATELLITE_QUICK_BUDGET_S = 3.0   # tyle pierwsza wersja raportu czeka na zdjęcia; resztę dociąga osobne zadanie

_followups: set[asyncio.Task] = set()   # dokończenia raportów (satelita) działające obok kolejki workera

_wake = asyncio.Event()   # budzi worker zaraz po dodaniu lub zmianie pola


@contextmanager
def _db():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    try:
        with con:
            con.execute("""CREATE TABLE IF NOT EXISTS fields (
                id TEXT PRIMARY KEY, name TEXT NOT NULL, input TEXT NOT NULL, created_at REAL NOT NULL,
                job TEXT NOT NULL, error TEXT, report TEXT, report_day TEXT, refreshed_at REAL,
                next_try REAL NOT NULL DEFAULT 0)""")
            yield con
    finally:
        con.close()


def field_id(inp: FieldInput) -> str:
    """Ten sam identyfikator co we frontendzie: działka, punkt albo obrys testowy (jedno pole na działkę)."""
    if inp.test:
        return "TEST"
    return inp.parcel_id or f"punkt:{inp.point.lat},{inp.point.lon}"


def default_name(inp: FieldInput) -> str:
    if inp.test:
        return "Działka testowa"
    return f"Działka {inp.parcel_id.rsplit('.', 1)[-1]}" if inp.parcel_id else "Wskazany punkt"


def report_request(inp: FieldInput) -> ReportRequest:
    return ReportRequest(parcel_id=inp.parcel_id, point=inp.point, crop=inp.crop, date=inp.date or today_warsaw(),
                         sowing_date=inp.sowing_date, harvest_date=inp.harvest_date, next_sowing_date=inp.next_sowing_date)


def _saved(row: sqlite3.Row) -> SavedField:
    return SavedField(
        id=row["id"], name=row["name"], input=FieldInput.model_validate_json(row["input"]), job=row["job"],
        error=row["error"], report=json.loads(row["report"]) if row["report"] else None,
        refreshed_at=datetime.fromtimestamp(row["refreshed_at"], timezone.utc) if row["refreshed_at"] else None)


def list_fields() -> list[SavedField]:
    with _db() as con:
        return [_saved(row) for row in con.execute("SELECT * FROM fields ORDER BY created_at DESC")]


def save_field(inp: FieldInput, previous_id: str | None = None) -> SavedField:
    """Dodaje albo zmienia pole. Zmiana danych do analizy kasuje stary raport i ustawia pole w kolejce;
    sama zmiana nazwy niczego nie przelicza."""
    new_id = field_id(inp)
    name = inp.name.strip() or default_name(inp)
    stored = inp.model_dump_json(exclude={"name"})
    with _db() as con:
        old = con.execute("SELECT input FROM fields WHERE id = ?", (previous_id or new_id,)).fetchone()
        if (old is not None and (previous_id or new_id) == new_id
                and FieldInput.model_validate_json(old["input"]).model_dump_json(exclude={"name"}) == stored):
            con.execute("UPDATE fields SET name = ? WHERE id = ?", (name, new_id))
        else:
            if previous_id and previous_id != new_id:
                con.execute("DELETE FROM fields WHERE id = ?", (previous_id,))
            con.execute("""INSERT INTO fields (id, name, input, created_at, job) VALUES (?, ?, ?, ?, 'queued')
                ON CONFLICT(id) DO UPDATE SET name = excluded.name, input = excluded.input, job = 'queued',
                error = NULL, report = NULL, report_day = NULL, refreshed_at = NULL, next_try = 0""",
                        (new_id, name, stored, time.time()))
        row = con.execute("SELECT * FROM fields WHERE id = ?", (new_id,)).fetchone()
    _wake.set()
    return _saved(row)


def delete_field(field_id_: str) -> bool:
    with _db() as con:
        return con.execute("DELETE FROM fields WHERE id = ?", (field_id_,)).rowcount > 0


def _claim(limit: int) -> list[sqlite3.Row]:
    """Pola do policzenia teraz: nowe, z raportem z poprzedniego dnia albo po błędzie, gdy minął czas ponowienia."""
    if limit <= 0:
        return []
    with _db() as con:
        rows = con.execute("""SELECT * FROM fields WHERE job = 'queued'
            OR (job = 'ok' AND (report_day IS NULL OR report_day < ?)) OR (job = 'error' AND next_try <= ?)
            ORDER BY next_try, created_at LIMIT ?""", (today_warsaw().isoformat(), time.time(), limit)).fetchall()
        for row in rows:
            con.execute("UPDATE fields SET job = 'running' WHERE id = ? AND input = ?", (row["id"], row["input"]))
    return rows


def _finish(row: sqlite3.Row, report: dict | None, error: str | None, day: str) -> None:
    """Zapis wyniku. `input = ?`: jeśli pole zmieniono w trakcie liczenia, stary wynik przepada (pole i tak
    czeka już w kolejce z nowymi danymi)."""
    with _db() as con:
        if report is not None:
            con.execute("""UPDATE fields SET job = 'ok', error = NULL, report = ?, report_day = ?, refreshed_at = ?
                WHERE id = ? AND input = ? AND job = 'running'""",
                        (json.dumps(report, ensure_ascii=False), day, time.time(), row["id"], row["input"]))
        else:
            con.execute("""UPDATE fields SET job = 'error', error = ?, next_try = ?
                WHERE id = ? AND input = ? AND job = 'running'""",
                        (error, time.time() + RETRY_S, row["id"], row["input"]))


def _spawn(coro) -> None:
    """Zadanie dodatkowe poza kolejką workera (nie zajmuje miejsca z WORKERS); referencja chroni przed GC."""
    task = asyncio.create_task(coro)
    _followups.add(task)
    task.add_done_callback(_followups.discard)


async def _complete_satellite(row: sqlite3.Row, inp: FieldInput) -> None:
    """Druga faza raportu: komplet zdjęć satelitarnych. Rolnik ogląda już pierwszą wersję, a frontend do tego czasu
    dociąga satelitę przez /api/satellite. Pobierania scen są wspólne (sentinel._submit), więc nic nie idzie dwa razy;
    pogoda, gleba i działka są już w pamięci podręcznej, więc liczy się tylko to, co brakowało."""
    try:
        report = await build_report(report_request(inp), satellite_budget_s=SATELLITE_DEFERRED_BUDGET_S)
    except Exception:
        log.exception("Uzupełnienie zdjęć satelitarnych pola %s się nie udało", row["id"])
        return
    with _db() as con:   # tylko gdy pole się w międzyczasie nie zmieniło i ma już pierwszą wersję raportu
        con.execute("UPDATE fields SET report = ?, refreshed_at = ? WHERE id = ? AND input = ? AND job = 'ok'",
                    (json.dumps(report.model_dump(mode="json"), ensure_ascii=False), time.time(), row["id"], row["input"]))


async def compute(row: sqlite3.Row) -> None:
    day = today_warsaw().isoformat()
    try:
        inp = FieldInput.model_validate_json(row["input"])
        # Pierwsza wersja raportu nie czeka na zdjęcia satelitarne: zapisujemy ją od razu, a satelitę (_complete_satellite)
        # i teren (terrain_service, uruchamiany w build_report) kończą osobne zadania równolegle.
        report = await build_report(report_request(inp), satellite_budget_s=SATELLITE_QUICK_BUDGET_S)
    except HTTPException as exc:
        _finish(row, None, str(exc.detail), day)
    except Exception as exc:   # błąd jednego pola nie może zatrzymać workera
        log.exception("Raport pola %s się nie policzył", row["id"])
        _finish(row, None, f"Nie udało się policzyć raportu ({type(exc).__name__}). Ponowię za {RETRY_S / 60:.0f} min.", day)
    else:
        _finish(row, report.model_dump(mode="json"), None, day)
        if report.satellite.status == Status.pending:
            _spawn(_complete_satellite(row, inp))


async def run_worker() -> None:
    """Pętla workera: liczy do WORKERS pól naraz, budzi się po zmianie pola albo co CHECK_EVERY_S."""
    with _db() as con:   # liczenie przerwane restartem serwera zaczyna się od nowa
        con.execute("UPDATE fields SET job = 'queued' WHERE job = 'running'")
    active: set[asyncio.Task] = set()
    while True:
        _wake.clear()
        for row in _claim(WORKERS - len(active)):
            task = asyncio.create_task(compute(row))
            active.add(task)
            task.add_done_callback(lambda t: (active.discard(t), _wake.set()))
        try:
            await asyncio.wait_for(_wake.wait(), CHECK_EVERY_S)
        except TimeoutError:
            pass
