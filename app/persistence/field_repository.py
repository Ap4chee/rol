"""Pola rolnika w SQLite: zapis, kolejka do liczenia i wynik ostatniego raportu.

Tylko dostęp do bazy, bez logiki raportu i bez asyncio. Wywołania są krótkie i blokujące, więc serwis
puszcza je przez asyncio.to_thread. Dane leżą w DATA_DIR, a nie w cache/, które wolno kasować.
"""
from __future__ import annotations

import json
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path

from app.schemas import FieldInput

SCHEMA = """CREATE TABLE IF NOT EXISTS fields (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, input TEXT NOT NULL, created_at REAL NOT NULL,
    job TEXT NOT NULL, error TEXT, report TEXT, report_day TEXT, refreshed_at REAL,
    next_try REAL NOT NULL DEFAULT 0)"""


@dataclass(frozen=True)
class StoredField:
    id: str
    name: str
    input: str            # FieldInput jako JSON, dokładnie w tej postaci, w jakiej go zapisano
    job: str              # queued | running | ok | error
    error: str | None
    report: dict | None
    refreshed_at: float | None   # czas uniksowy [s]

    @classmethod
    def from_row(cls, row: sqlite3.Row) -> StoredField:
        return cls(id=row["id"], name=row["name"], input=row["input"], job=row["job"], error=row["error"],
                   report=json.loads(row["report"]) if row["report"] else None, refreshed_at=row["refreshed_at"])


class FieldRepository:
    def __init__(self, db_path: Path) -> None:
        self._path = db_path
        self._path.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as con:
            con.execute(SCHEMA)

    @contextmanager
    def _connect(self) -> Iterator[sqlite3.Connection]:
        con = sqlite3.connect(self._path)
        con.row_factory = sqlite3.Row
        try:
            with con:
                yield con
        finally:
            con.close()

    def list(self) -> list[StoredField]:
        with self._connect() as con:
            return [StoredField.from_row(r) for r in con.execute("SELECT * FROM fields ORDER BY created_at DESC")]

    def get(self, field_id: str) -> StoredField | None:
        with self._connect() as con:
            row = con.execute("SELECT * FROM fields WHERE id = ?", (field_id,)).fetchone()
        return StoredField.from_row(row) if row else None

    def save(self, field_id: str, name: str, inp: FieldInput, previous_id: str | None, now: float) -> StoredField:
        """Zmiana danych do analizy kasuje stary raport i ustawia pole w kolejce; sama zmiana nazwy niczego nie przelicza."""
        stored = inp.model_dump_json(exclude={"name"})
        with self._connect() as con:
            old = con.execute("SELECT input FROM fields WHERE id = ?", (previous_id or field_id,)).fetchone()
            if (old is not None and (previous_id or field_id) == field_id
                    and FieldInput.model_validate_json(old["input"]).model_dump_json(exclude={"name"}) == stored):
                con.execute("UPDATE fields SET name = ? WHERE id = ?", (name, field_id))
            else:
                if previous_id and previous_id != field_id:
                    con.execute("DELETE FROM fields WHERE id = ?", (previous_id,))
                con.execute("""INSERT INTO fields (id, name, input, created_at, job) VALUES (?, ?, ?, ?, 'queued')
                    ON CONFLICT(id) DO UPDATE SET name = excluded.name, input = excluded.input, job = 'queued',
                    error = NULL, report = NULL, report_day = NULL, refreshed_at = NULL, next_try = 0""",
                            (field_id, name, stored, now))
            row = con.execute("SELECT * FROM fields WHERE id = ?", (field_id,)).fetchone()
        return StoredField.from_row(row)

    def delete(self, field_id: str) -> bool:
        with self._connect() as con:
            return con.execute("DELETE FROM fields WHERE id = ?", (field_id,)).rowcount > 0

    def claim(self, limit: int, today_iso: str, now: float) -> list[StoredField]:
        """Pola do policzenia teraz: nowe, z raportem z poprzedniego dnia albo po błędzie, gdy minął czas ponowienia."""
        if limit <= 0:
            return []
        with self._connect() as con:
            rows = con.execute("""SELECT * FROM fields WHERE job = 'queued'
                OR (job = 'ok' AND (report_day IS NULL OR report_day < ?)) OR (job = 'error' AND next_try <= ?)
                ORDER BY next_try, created_at LIMIT ?""", (today_iso, now, limit)).fetchall()
            for row in rows:
                con.execute("UPDATE fields SET job = 'running' WHERE id = ? AND input = ?", (row["id"], row["input"]))
        return [StoredField.from_row(r) for r in rows]

    def finish_ok(self, field: StoredField, report: dict, day_iso: str, now: float) -> None:
        """`input = ?`: jeśli pole zmieniono w trakcie liczenia, stary wynik przepada (pole i tak czeka już w kolejce)."""
        with self._connect() as con:
            con.execute("""UPDATE fields SET job = 'ok', error = NULL, report = ?, report_day = ?, refreshed_at = ?
                WHERE id = ? AND input = ? AND job = 'running'""",
                        (json.dumps(report, ensure_ascii=False), day_iso, now, field.id, field.input))

    def finish_error(self, field: StoredField, error: str, next_try: float) -> None:
        with self._connect() as con:
            con.execute("""UPDATE fields SET job = 'error', error = ?, next_try = ?
                WHERE id = ? AND input = ? AND job = 'running'""", (error, next_try, field.id, field.input))

    def requeue_running(self) -> None:
        """Liczenie przerwane restartem serwera zaczyna się od nowa."""
        with self._connect() as con:
            con.execute("UPDATE fields SET job = 'queued' WHERE job = 'running'")
