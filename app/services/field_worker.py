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
from app.infra.http import new_client
from app.persistence.field_repository import FieldRepository, StoredField
from app.schemas import FieldInput, ReportRequest, SavedField, Status
from app.services import ml_bridge
from app.services.errors import ReportUnavailable
from app.services.report_builder import ReportBuilder
from app.services.source_gatherer import SourceGatherer
from app.services.terrain_jobs import TerrainJobs

log = logging.getLogger(__name__)

WORKERS = 2            # tyle raportów naraz; każdy i tak pobiera swoje źródła równolegle
CHECK_EVERY_S = 60.0   # jak często worker sprawdza, czy nadszedł nowy dzień albo pora ponowienia
RETRY_S = 15 * 60.0
SATELLITE_QUICK_BUDGET_S = 0.0   # pierwsza wersja raportu nie czeka na zdjęcia; dociąga je osobne zadanie


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
                 today: Callable[[], date] = today_warsaw,
                 terrain: TerrainJobs | None = None, parcels: SourceGatherer | None = None) -> None:
        self._repo = repository
        self._builder = builder
        self._today = today
        # Teren pól liczymy z wyprzedzeniem tylko wtedy, gdy dostaliśmy oba: kolejkę terenu i sposób na działkę.
        self._terrain = terrain
        self._parcels = parcels
        self._wake = asyncio.Event()   # budzi pętlę zaraz po dodaniu lub zmianie pola
        self._progress: dict[str, dict[str, str]] = {}   # id pola → etap → stan
        # Dokończenia raportów (satelita) działają obok kolejki i nie zajmują miejsca z WORKERS.
        # Trzymamy referencje, bo asyncio pilnuje zadań tylko słabo i GC mógłby je zebrać w trakcie.
        self._followups: set[asyncio.Task] = set()

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
            # Pierwsza wersja raportu nie czeka na zdjęcia satelitarne: rolnik widzi ją od razu, a satelitę
            # dokańcza osobne zadanie (_complete_report). Teren i tak liczy się osobno w TerrainJobs.
            report = await self._builder.build(report_request(inp, day), satellite_budget_s=SATELLITE_QUICK_BUDGET_S,
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
            if report.satellite.status == Status.pending:
                self._spawn(self._complete_report(field, inp, day))
            self._spawn(self._prepare_terrain([inp]))   # teren osobno, równolegle z dociąganiem satelity
        finally:
            if self._progress.get(field.id) is stages:
                del self._progress[field.id]

    def _spawn(self, coro) -> None:
        task = asyncio.create_task(coro)
        self._followups.add(task)
        task.add_done_callback(self._followups.discard)

    async def _complete_report(self, field: StoredField, inp: FieldInput, day: date) -> None:
        """Druga faza raportu: komplet zdjęć satelitarnych. Frontend do tego czasu dociąga satelitę przez
        /api/satellite. Sceny pobieramy wspólnie (sentinel._submit), a pogoda, gleba i działka są już
        w pamięci podręcznej, więc liczy się tylko to, czego brakowało."""
        try:
            report = await self._builder.build(report_request(inp, day), satellite_budget_s=SATELLITE_DEFERRED_BUDGET_S)
        except Exception:
            log.exception("Uzupełnienie zdjęć satelitarnych pola %s się nie udało", field.id)
            return
        await asyncio.to_thread(self._repo.replace_report, field, report.model_dump(mode="json"), time.time())

    async def _prepare_terrain(self, inputs: list[FieldInput]) -> None:
        """Teren pól liczony w tle, żeby przy otwarciu raportu był już gotowy. Po kolei, bo arkusz NMT
        pobieramy jeden naraz. Pole z terenem w pamięci podręcznej kosztuje tylko zapytanie o działkę."""
        if self._terrain is None or self._parcels is None:
            return
        for inp in inputs:
            try:
                async with new_client() as client:
                    parcel, _info = await self._parcels.resolve_parcel(client, report_request(inp, self._today()))
                if parcel is not None:
                    await self._terrain.get(parcel)   # z pamięci podręcznej albo liczy i zapisuje
            except Exception:   # błąd terenu jednego pola nie zatrzymuje pozostałych; raport poda powód
                log.exception("Teren pola %s nie policzył się w tle", field_id(inp))

    async def run(self) -> None:
        """Pętla workera: liczy do WORKERS pól naraz, budzi się po zmianie pola albo co CHECK_EVERY_S."""
        await asyncio.to_thread(self._repo.requeue_running)
        self._spawn(asyncio.to_thread(ml_bridge.warm_up))
        # Po restarcie albo wyczyszczeniu cache teren wszystkich pól liczy się od nowa, zanim ktoś otworzy raport.
        stored = await asyncio.to_thread(self._repo.list)
        self._spawn(self._prepare_terrain([FieldInput.model_validate_json(f.input) for f in stored]))
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
