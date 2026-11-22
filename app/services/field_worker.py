"""Pola rolnika i worker, który liczy ich raporty w tle.

Raport liczy się zaraz po dodaniu pola (albo zmianie działki, uprawy lub daty), a potem raz na dobę według
czasu Europe/Warsaw. Pole bez daty analizuje zawsze dzisiejszy dzień, pole z datą historyczną tę datę.
Nieudane liczenie worker ponawia co RETRY_S, a ostatni dobry raport zostaje widoczny do tego czasu.
Worker działa w procesie serwera (start w lifespan aplikacji), więc serwer uruchamiamy jednym procesem uvicorn.
"""
from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Callable
from datetime import UTC, date, datetime

from app.config import SATELLITE_DEFERRED_BUDGET_S
from app.core.dates import InvalidAnalysisDate, today_warsaw
from app.persistence.field_repository import FieldRepository, StoredField
from app.schemas import FieldInput, ReportRequest, SavedField
from app.services.errors import ReportUnavailable
from app.services.report_builder import ReportBuilder

log = logging.getLogger(__name__)

WORKERS = 2            # tyle raportów naraz; każdy i tak pobiera swoje źródła równolegle
CHECK_EVERY_S = 60.0   # jak często worker sprawdza, czy nadszedł nowy dzień albo pora ponowienia
RETRY_S = 15 * 60.0


def field_id(inp: FieldInput) -> str:
    """Ten sam identyfikator co we frontendzie: działka, punkt albo obrys testowy (jedno pole na działkę)."""
    if inp.test:
        return "TEST"
    return inp.parcel_id or f"punkt:{inp.point.lat},{inp.point.lon}"


def default_name(inp: FieldInput) -> str:
    if inp.test:
        return "Działka testowa"
    return f"Działka {inp.parcel_id.rsplit('.', 1)[-1]}" if inp.parcel_id else "Wskazany punkt"


def report_request(inp: FieldInput, today: date) -> ReportRequest:
    return ReportRequest(parcel_id=inp.parcel_id, point=inp.point, crop=inp.crop, date=inp.date or today,
                         sowing_date=inp.sowing_date, harvest_date=inp.harvest_date, next_sowing_date=inp.next_sowing_date)


class FieldWorker:
    """Zapisane pola, kolejka liczenia i etapy raportów liczonych w tej chwili (tylko w pamięci procesu)."""

    def __init__(self, repository: FieldRepository, builder: ReportBuilder,
                 today: Callable[[], date] = today_warsaw) -> None:
        self._repo = repository
        self._builder = builder
        self._today = today
        self._wake = asyncio.Event()   # budzi pętlę zaraz po dodaniu lub zmianie pola
        self._progress: dict[str, dict[str, str]] = {}   # id pola → etap → stan

    def _saved(self, field: StoredField) -> SavedField:
        running = field.job == "running" and field.id in self._progress
        return SavedField(
            id=field.id, name=field.name, input=FieldInput.model_validate_json(field.input), job=field.job,
            error=field.error, report=field.report, progress=dict(self._progress[field.id]) if running else None,
            refreshed_at=datetime.fromtimestamp(field.refreshed_at, UTC) if field.refreshed_at else None)

    async def list_fields(self) -> list[SavedField]:
        return [self._saved(f) for f in await asyncio.to_thread(self._repo.list)]

    async def save_field(self, inp: FieldInput, previous_id: str | None = None) -> SavedField:
        """Odpowiada od razu; raport policzy pętla workera."""
        name = inp.name.strip() or default_name(inp)
        stored = await asyncio.to_thread(self._repo.save, field_id(inp), name, inp, previous_id, time.time())
        self._wake.set()
        return self._saved(stored)

    async def delete_field(self, id_: str) -> bool:
        return await asyncio.to_thread(self._repo.delete, id_)

    async def compute(self, field: StoredField) -> None:
        day = self._today()
        stages = self._progress[field.id] = {}
        try:
            inp = FieldInput.model_validate_json(field.input)
            # w tle nikt nie czeka, więc satelita dostaje pełny czas, a raport jest od razu kompletny
            report = await self._builder.build(report_request(inp, day), satellite_budget_s=SATELLITE_DEFERRED_BUDGET_S,
                                               progress=stages.__setitem__)
        except (ReportUnavailable, InvalidAnalysisDate) as exc:
            await asyncio.to_thread(self._repo.finish_error, field, str(exc), time.time() + RETRY_S)
        except Exception as exc:   # błąd jednego pola nie może zatrzymać workera
            log.exception("Raport pola %s się nie policzył", field.id)
            reason = f"Nie udało się policzyć raportu ({type(exc).__name__}). Ponowię za {RETRY_S / 60:.0f} min."
            await asyncio.to_thread(self._repo.finish_error, field, reason, time.time() + RETRY_S)
        else:
            await asyncio.to_thread(self._repo.finish_ok, field, report.model_dump(mode="json"), day.isoformat(),
                                    time.time())
        finally:
            if self._progress.get(field.id) is stages:
                del self._progress[field.id]

    async def run(self) -> None:
        """Pętla workera: liczy do WORKERS pól naraz, budzi się po zmianie pola albo co CHECK_EVERY_S."""
        await asyncio.to_thread(self._repo.requeue_running)
        active: set[asyncio.Task] = set()
        while True:
            self._wake.clear()
            claimed = await asyncio.to_thread(self._repo.claim, WORKERS - len(active), self._today().isoformat(),
                                              time.time())
            for field in claimed:
                task = asyncio.create_task(self.compute(field))
                active.add(task)
                task.add_done_callback(lambda t: (active.discard(t), self._wake.set()))
            try:
                await asyncio.wait_for(self._wake.wait(), CHECK_EVERY_S)
            except TimeoutError:
                pass
