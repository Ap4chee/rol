"""Serwer aplikacji: API raportu i statyczny frontend. Uruchomienie: `uvicorn app.main:app`."""
from __future__ import annotations

from datetime import date as Date

import httpx
from fastapi import FastAPI, Query
from fastapi.staticfiles import StaticFiles

from app.config import SATELLITE_DEFERRED_BUDGET_S, SOIL_ASSETS_DIR, STATIC_DIR, USER_AGENT
from app.core.crops import CROPS
from app import terrain_service
from app.report import _parcel_info, build_report
from app.schemas import (
    CropKey,
    CropOption,
    ParcelCandidate,
    ParcelSearchResponse,
    ReportRequest,
    ReportResponse,
    SatelliteResponse,
    Status,
    TerrainResponse,
)
from app.sources import NoData, SourceError, uldk

app = FastAPI(
    title="KOWR – Zatrzymaj wodę, chroń plony",
    description="Raport sytuacji wodnej działki rolnej liczony na żywo z otwartych danych.",
    version="0.1.0",
)


@app.get("/api/crops", response_model=list[CropOption])
async def crops() -> list[CropOption]:
    """Lista upraw do wyboru w formularzu."""
    return [CropOption(key=CropKey(key), name=crop.name) for key, crop in CROPS.items()]


@app.get("/api/parcels/search", response_model=ParcelSearchResponse)
async def parcels_search(q: str = Query(min_length=2, max_length=80)) -> ParcelSearchResponse:
    """Szukanie działki po „nazwa obrębu numer” albo po identyfikatorze. Może zwrócić wiele trafień."""
    async with httpx.AsyncClient(headers={"User-Agent": USER_AGENT}) as client:
        try:
            candidates, truncated = await uldk.search_parcels(client, q)
        except NoData as exc:
            return ParcelSearchResponse(status=Status.no_data, reason=str(exc))
        except SourceError as exc:
            return ParcelSearchResponse(status=Status.error, reason=str(exc))
    if not candidates:
        return ParcelSearchResponse(status=Status.no_data, reason="ULDK nie znalazło działki o takim opisie.")
    return ParcelSearchResponse(status=Status.ok, truncated=truncated,
                                candidates=[ParcelCandidate(**c) for c in candidates])


def _parcel_response(parcel: uldk.Parcel) -> ParcelSearchResponse:
    return ParcelSearchResponse(status=Status.ok, parcel=_parcel_info(parcel), candidates=[ParcelCandidate(
        id=parcel.id, number=parcel.number, region=parcel.region, commune=parcel.commune,
        county=parcel.county, voivodeship=parcel.voivodeship)])


@app.get("/api/parcels/by-point", response_model=ParcelSearchResponse)
async def parcels_by_point(lon: float = Query(ge=14.0, le=24.3), lat: float = Query(ge=48.9, le=55.0)) -> ParcelSearchResponse:
    """Działka zawierająca punkt wskazany na mapie (EPSG:4326), z geometrią."""
    async with httpx.AsyncClient(headers={"User-Agent": USER_AGENT}) as client:
        try:
            parcel, _ = await uldk.get_parcel_by_point(client, lon, lat)
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
            parcel, _ = await uldk.get_parcel_by_id(client, id)
        except NoData as exc:
            return ParcelSearchResponse(status=Status.no_data, reason=str(exc))
        except SourceError as exc:
            return ParcelSearchResponse(status=Status.error, reason=str(exc))
    return _parcel_response(parcel)


@app.post("/api/report", response_model=ReportResponse)
async def report(request: ReportRequest) -> ReportResponse:
    """Raport dla działki (identyfikator albo punkt), uprawy i daty. Liczony na żywo."""
    return await build_report(request)


@app.get("/api/satellite", response_model=SatelliteResponse)
async def satellite(parcel_id: str = Query(min_length=5, max_length=80), crop: CropKey = Query(),
                    date: Date = Query()) -> SatelliteResponse:
    """Komplet obserwacji satelitarnych, gdy nie zdążyły się wczytać razem z raportem (wolne łącze do archiwum).

    Pogoda, gleba i działka są już w pamięci podręcznej, więc bilans potrzebny do oceny zgodności liczy się od razu.
    """
    full = await build_report(ReportRequest(parcel_id=parcel_id, crop=crop, date=date),
                              satellite_budget_s=SATELLITE_DEFERRED_BUDGET_S)
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
            parcel, _ = await uldk.get_parcel_by_id(client, parcel_id)
        except (NoData, SourceError) as exc:
            return TerrainResponse(status=Status.error, reason=f"Nie udało się pobrać granic działki: {exc}",
                                   parcel_id=parcel_id,
                                   source=terrain_service._source(Status.error, str(exc)))
    return await terrain_service.get(parcel)


# Ilustracje warstw gleby (umowne, dobierane po klasie uziarnienia; opis w outputs/assety_gleby/README.md).
if SOIL_ASSETS_DIR.is_dir():
    app.mount("/soil-assets", StaticFiles(directory=SOIL_ASSETS_DIR), name="soil-assets")

if STATIC_DIR.is_dir():
    app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
