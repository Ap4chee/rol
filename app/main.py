"""Serwer aplikacji: API raportu i statyczny frontend. Uruchomienie: `uvicorn app.main:app`."""
from __future__ import annotations

import asyncio
import mimetypes
from contextlib import asynccontextmanager
from datetime import date as Date
from datetime import datetime
from zoneinfo import ZoneInfo

import httpx
from fastapi import FastAPI, HTTPException, Query
from fastapi.staticfiles import StaticFiles
from pydantic import ValidationError

from app import fields, terrain_service
from app.config import SATELLITE_DEFERRED_BUDGET_S, SOIL_ASSETS_DIR, STATIC_DIR, USER_AGENT
from app.core import fieldwork
from app.core.crops import CROPS
from app.report import MIN_ANALYSIS_DATE, _parcel_info, build_report, today_warsaw
from app.schemas import (
    AddressMatch,
    AddressQuery,
    CropKey,
    CropOption,
    FieldInput,
    FieldworkResponse,
    ForecastResponse,
    ParcelCandidate,
    ParcelSearchResponse,
    ReportRequest,
    ReportResponse,
    SatelliteResponse,
    SavedField,
    Status,
    TerrainResponse,
)
from app.sources import NoData, SourceError, address, parcels
from app.sources.weather import fetch_dashboard_forecast

# Windows bierze typy plików z rejestru i często nie zna tych rozszerzeń.
mimetypes.add_type("image/webp", ".webp")
mimetypes.add_type("font/woff2", ".woff2")

@asynccontextmanager
async def lifespan(_app: FastAPI):
    """Worker raportów pól (app/fields.py) działa razem z serwerem."""
    worker = asyncio.create_task(fields.run_worker())
    yield
    worker.cancel()


app = FastAPI(
    title="KOWR – Zatrzymaj wodę, chroń plony",
    description="Raport sytuacji wodnej działki rolnej liczony na żywo z otwartych danych.",
    version="0.1.0",
    lifespan=lifespan,
)


@app.middleware("http")
async def revalidate_frontend(request, call_next):
    """Przeglądarka ma zawsze sprawdzić, czy frontend się zmienił (ETag → 304), zamiast trzymać stary ui.js."""
    response = await call_next(request)
    if not request.url.path.startswith("/api/"):
        response.headers.setdefault("Cache-Control", "no-cache")
    return response


@app.get("/api/crops", response_model=list[CropOption])
async def crops() -> list[CropOption]:
    """Lista upraw do wyboru w formularzu."""
    return [CropOption(key=CropKey(key), name=crop.name) for key, crop in CROPS.items()]


@app.post("/api/addresses/search", response_model=list[AddressMatch])
async def search_address(body: AddressQuery) -> list[AddressMatch]:
    """Punkty pomocnicze do ustawienia mapy. Wpisany adres nie trafia do zapisu pola."""
    query = " ".join(body.query.split())
    if len(query) < 2:
        raise HTTPException(status_code=422, detail="Wpisz adres lub nazwę miejscowości.")
    async with httpx.AsyncClient(headers={"User-Agent": USER_AGENT}, follow_redirects=True) as client:
        try:
            return await address.search(client, query)
        except SourceError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.get("/api/parcels/search", response_model=ParcelSearchResponse)
async def parcels_search(q: str = Query(min_length=2, max_length=80)) -> ParcelSearchResponse:
    """Szukanie działki po „nazwa obrębu numer” albo po identyfikatorze. Może zwrócić wiele trafień."""
    async with httpx.AsyncClient(headers={"User-Agent": USER_AGENT}) as client:
        try:
            candidates, truncated = await parcels.search_parcels(client, q)
        except NoData as exc:
            return ParcelSearchResponse(status=Status.no_data, reason=str(exc))
        except SourceError as exc:
            return ParcelSearchResponse(status=Status.error, reason=str(exc))
    if not candidates:
        return ParcelSearchResponse(status=Status.no_data, reason="ULDK nie znalazło działki o takim opisie.")
    return ParcelSearchResponse(status=Status.ok, truncated=truncated,
                                candidates=[ParcelCandidate(**c) for c in candidates])


def _parcel_response(parcel: parcels.Parcel) -> ParcelSearchResponse:
    return ParcelSearchResponse(status=Status.ok, parcel=_parcel_info(parcel), candidates=[ParcelCandidate(
        id=parcel.id, number=parcel.number, region=parcel.region, commune=parcel.commune,
        county=parcel.county, voivodeship=parcel.voivodeship)])


@app.get("/api/parcels/by-point", response_model=ParcelSearchResponse)
async def parcels_by_point(lon: float = Query(ge=14.0, le=24.3), lat: float = Query(ge=48.9, le=55.0)) -> ParcelSearchResponse:
    """Działka zawierająca punkt wskazany na mapie (EPSG:4326), z geometrią."""
    async with httpx.AsyncClient(headers={"User-Agent": USER_AGENT}) as client:
        try:
            parcel, _ = await parcels.get_parcel_by_point(client, lon, lat)
        except NoData as exc:
            return ParcelSearchResponse(status=Status.no_data, reason=str(exc))
        except SourceError as exc:
            return ParcelSearchResponse(status=Status.error, reason=str(exc))
    return _parcel_response(parcel)


@app.get("/api/parcels/by-id", response_model=ParcelSearchResponse)
async def parcels_by_id(id: str = Query(min_length=5, max_length=80)) -> ParcelSearchResponse:
    """Działka po pełnym identyfikatorze, z geometrią."""
    async with httpx.AsyncClient(headers={"User-Agent": USER_AGENT}) as client:
        try:
            parcel, _ = await parcels.get_parcel_by_id(client, id)
        except NoData as exc:
            return ParcelSearchResponse(status=Status.no_data, reason=str(exc))
        except SourceError as exc:
            return ParcelSearchResponse(status=Status.error, reason=str(exc))
    return _parcel_response(parcel)


@app.post("/api/report", response_model=ReportResponse)
async def report(request: ReportRequest) -> ReportResponse:
    """Raport dla działki (identyfikator albo punkt), uprawy i daty. Liczony na żywo."""
    return await build_report(request)


@app.get("/api/fields", response_model=list[SavedField])
async def list_fields() -> list[SavedField]:
    """Zapisane pola z ostatnim raportem i stanem liczenia (`job`). Raporty liczy worker w tle."""
    return fields.list_fields()


@app.post("/api/fields", response_model=SavedField)
async def save_field(body: FieldInput,
                     previous_id: str | None = Query(default=None, max_length=120)) -> SavedField:
    """Dodaje albo zmienia pole (`previous_id`: identyfikator pola przed zmianą działki). Odpowiada od razu,
    raport liczy się w tle, a potem raz na dobę."""
    if body.date is not None and not (MIN_ANALYSIS_DATE <= body.date <= today_warsaw()):
        raise HTTPException(status_code=422, detail="Data analizy musi być między 01.01.2005 a dzisiejszym dniem.")
    return fields.save_field(body, previous_id)


@app.delete("/api/fields")
async def delete_field(id: str = Query(min_length=1, max_length=120)) -> dict:
    if not fields.delete_field(id):
        raise HTTPException(status_code=404, detail="Nie ma takiego pola.")
    return {"deleted": id}


@app.get("/api/forecast", response_model=ForecastResponse)
async def forecast(lon: float = Query(ge=14.0, le=24.3), lat: float = Query(ge=48.9, le=55.0),
                   days: int = Query(default=16, ge=1, le=16)) -> ForecastResponse:
    """Lokalna prognoza na pulpit i zakładkę Pogoda (do 16 dni), poza historycznym bilansem raportu."""
    today = datetime.now(ZoneInfo("Europe/Warsaw")).date()
    async with httpx.AsyncClient(headers={"User-Agent": USER_AGENT}) as client:
        try:
            return await fetch_dashboard_forecast(client, lat, lon, today, days=days)
        except NoData as exc:
            return ForecastResponse(status=Status.no_data, reason=str(exc))
        except SourceError as exc:
            return ForecastResponse(status=Status.error, reason=str(exc))


@app.get("/api/fieldwork", response_model=FieldworkResponse)
async def fieldwork_plan(lon: float = Query(ge=14.0, le=24.3), lat: float = Query(ge=48.9, le=55.0), crop: CropKey = Query(),
                         sand: float | None = Query(default=None, ge=0, le=100),
                         clay: float | None = Query(default=None, ge=0, le=100),
                         soc: float | None = Query(default=None, ge=0, le=600)) -> FieldworkResponse:
    """Plan prac polowych na 7 dni od dziś: prognoza Open-Meteo i uziarnienie wierzchu gleby (0–10 cm) z raportu pola."""
    if sand is not None and clay is not None and sand + clay > 100.5:   # zapas na zaokrąglenie średnich do 0,1
        raise HTTPException(status_code=422, detail="Piasek i ił razem nie mogą przekraczać 100%.")
    today = datetime.now(ZoneInfo("Europe/Warsaw")).date()
    async with httpx.AsyncClient(headers={"User-Agent": USER_AGENT}) as client:
        try:
            # plan prac zawsze na 7 dni (prognoza na pulpit ma do 16)
            forecast = await fetch_dashboard_forecast(client, lat, lon, today, days=7)
        except (NoData, SourceError) as exc:
            return FieldworkResponse(status=Status.no_data if isinstance(exc, NoData) else Status.error,
                                     reason=f"Brak prognozy pogody: {exc}", crop=crop)
    fc, wp, rew, soil_assumed = fieldwork.surface_soil(sand, clay, soc)
    rows = [*forecast.recent, *forecast.days]
    days = fieldwork.plan_fieldwork(
        [d.date for d in rows], [d.precipitation_mm for d in rows], [d.et0_mm for d in rows],
        [d.temperature_max_c for d in rows], [d.temperature_min_c for d in rows], [d.wind_max_kmh for d in rows],
        [d.weather_code for d in rows], len(forecast.recent), CROPS[crop.value], fc, wp, rew)
    notes: list[str] = []   # tylko braki danych; ograniczenia planu opisuje README
    if soil_assumed:
        notes.insert(0, "Brak danych o glebie pola: wilgotność wierzchu policzona dla gleby umownej (glina).")
    if not forecast.past_days_complete:
        notes.insert(0, "Brakuje części danych o opadzie z ostatnich 30 dni, więc wilgotności gleby nie oceniono.")
    return FieldworkResponse(status=Status.ok, crop=crop, soil_assumed=soil_assumed, days=days,
                             windows=fieldwork.best_windows(days), notes=notes)


@app.get("/api/satellite", response_model=SatelliteResponse)
async def satellite(parcel_id: str = Query(min_length=5, max_length=80), crop: CropKey = Query(),
                    date: Date = Query(), sowing_date: Date | None = None, harvest_date: Date | None = None,
                    next_sowing_date: Date | None = None) -> SatelliteResponse:
    """Komplet obserwacji satelitarnych, gdy nie zdążyły się wczytać razem z raportem (wolne łącze do archiwum).

    Pogoda, gleba i działka są już w pamięci podręcznej, więc bilans potrzebny do oceny zgodności liczy się od razu.
    """
    try:
        request = ReportRequest(parcel_id=parcel_id, crop=crop, date=date, sowing_date=sowing_date,
                                harvest_date=harvest_date, next_sowing_date=next_sowing_date)
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=exc.errors()[0]["msg"]) from exc
    full = await build_report(request, satellite_budget_s=SATELLITE_DEFERRED_BUDGET_S)
    source = next((s for s in full.sources if s.key == "satellite"), None)
    checks = [r for r in full.recommendations.field_checks if r.key == "satellite_divergence"]
    return SatelliteResponse(satellite=full.satellite, source=source, field_checks=checks)


@app.get("/api/terrain", response_model=TerrainResponse)
async def terrain(parcel_id: str = Query(min_length=5, max_length=80)) -> TerrainResponse:
    """Teren i spływ wody dla działki: spadek, drogi spływu, punkty dopływu i odpływu, wnioski.

    Liczone osobno, bo wycinek numerycznego modelu terenu z WCS GUGiK trwa kilkanaście do kilkudziesięciu sekund.
    """
    async with httpx.AsyncClient(headers={"User-Agent": USER_AGENT}) as client:
        try:
            parcel, _ = await parcels.get_parcel_by_id(client, parcel_id)
        except (NoData, SourceError) as exc:
            return TerrainResponse(status=Status.error, reason=f"Nie udało się pobrać granic działki: {exc}",
                                   parcel_id=parcel_id,
                                   source=terrain_service._source(Status.error, str(exc)))
    return await terrain_service.get(parcel)


# Ilustracje warstw gleby (umowne, dobierane po klasie uziarnienia; opis w docs/assets/gleba/README.md).
if SOIL_ASSETS_DIR.is_dir():
    app.mount("/soil-assets", StaticFiles(directory=SOIL_ASSETS_DIR), name="soil-assets")

if STATIC_DIR.is_dir():
    app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
