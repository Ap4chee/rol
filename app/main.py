"""Fabryka aplikacji: serwisy, routery API, worker pól i statyczny frontend. Uruchomienie: `uvicorn app.main:app`.

Endpointy są w app/api/routers, logika w app/services. Tu tylko składanie całości.
"""
from __future__ import annotations

import asyncio
import mimetypes
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app.api import errors
from app.api.routers import fields, fieldwork, forecast, parcels, report, satellite, terrain
from app.config import DATA_DIR, SOIL_ASSETS_DIR, STATIC_DIR
from app.persistence.field_repository import FieldRepository
from app.services.field_worker import FieldWorker
from app.services.fieldwork_planner import FieldworkPlanner
from app.services.report_builder import ReportBuilder
from app.services.source_gatherer import SourceGatherer
from app.services.terrain_jobs import TerrainJobs

# Windows bierze typy plików z rejestru i często nie zna tych rozszerzeń.
mimetypes.add_type("image/webp", ".webp")
mimetypes.add_type("font/woff2", ".woff2")

FIELDS_DB = "fields.sqlite3"


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Worker raportów pól działa razem z serwerem."""
    worker = asyncio.create_task(app.state.field_worker.run())
    yield
    worker.cancel()


async def revalidate_frontend(request, call_next):
    """Przeglądarka ma zawsze sprawdzić, czy frontend się zmienił (ETag → 304), zamiast trzymać stary ui.js."""
    response = await call_next(request)
    if not request.url.path.startswith("/api/"):
        response.headers.setdefault("Cache-Control", "no-cache")
    return response


def create_app(data_dir: Path = DATA_DIR) -> FastAPI:
    app = FastAPI(
        title="KOWR – Zatrzymaj wodę, chroń plony",
        description="Raport sytuacji wodnej działki rolnej liczony na żywo z otwartych danych.",
        version="0.1.0",
        lifespan=lifespan,
    )
    terrain_jobs = TerrainJobs()
    builder = ReportBuilder(SourceGatherer(start_terrain=terrain_jobs.start))
    app.state.terrain_jobs = terrain_jobs
    app.state.report_builder = builder
    app.state.field_worker = FieldWorker(FieldRepository(data_dir / FIELDS_DB), builder)
    app.state.fieldwork_planner = FieldworkPlanner()

    app.middleware("http")(revalidate_frontend)
    errors.install(app)
    for module in (report, parcels, fields, forecast, fieldwork, satellite, terrain):
        app.include_router(module.router)

    # Ilustracje warstw gleby (umowne, dobierane po klasie uziarnienia; opis w docs/assets/gleba/README.md).
    if SOIL_ASSETS_DIR.is_dir():
        app.mount("/soil-assets", StaticFiles(directory=SOIL_ASSETS_DIR), name="soil-assets")
    if STATIC_DIR.is_dir():
        app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
    return app


app = create_app()
