"""Wskazanie działki: adres na mapie, szukanie po opisie, po punkcie i po identyfikatorze."""
from __future__ import annotations

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query

from app.api.deps import http_client
from app.api.errors import source_status
from app.api.validators import Lat, Lon, ParcelId
from app.presentation.sections.parcel import parcel_info
from app.schemas import AddressMatch, AddressQuery, ParcelCandidate, ParcelSearchResponse, Status
from app.sources import NoData, SourceError, address, parcels

router = APIRouter(prefix="/api")

MIN_ADDRESS_CHARS = 2


@router.post("/addresses/search", response_model=list[AddressMatch])
async def search_address(body: AddressQuery, client: httpx.AsyncClient = Depends(http_client)) -> list[AddressMatch]:
    """Punkty pomocnicze do ustawienia mapy. Wpisany adres nie trafia do zapisu pola."""
    query = " ".join(body.query.split())
    if len(query) < MIN_ADDRESS_CHARS:
        raise HTTPException(status_code=422, detail="Wpisz adres lub nazwę miejscowości.")
    try:
        return await address.search(client, query)
    except SourceError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.get("/parcels/search", response_model=ParcelSearchResponse)
async def parcels_search(q: str = Query(min_length=2, max_length=80),
                         client: httpx.AsyncClient = Depends(http_client)) -> ParcelSearchResponse:
    """Szukanie działki po „nazwa obrębu numer” albo po identyfikatorze. Może zwrócić wiele trafień."""
    try:
        candidates, truncated = await parcels.search_parcels(client, q)
    except (NoData, SourceError) as exc:
        return ParcelSearchResponse(status=source_status(exc), reason=str(exc))
    if not candidates:
        return ParcelSearchResponse(status=Status.no_data, reason="ULDK nie znalazło działki o takim opisie.")
    return ParcelSearchResponse(status=Status.ok, truncated=truncated,
                                candidates=[ParcelCandidate(**c) for c in candidates])


def _parcel_response(parcel: parcels.Parcel) -> ParcelSearchResponse:
    return ParcelSearchResponse(status=Status.ok, parcel=parcel_info(parcel), candidates=[ParcelCandidate(
        id=parcel.id, number=parcel.number, region=parcel.region, commune=parcel.commune,
        county=parcel.county, voivodeship=parcel.voivodeship)])


@router.get("/parcels/by-point", response_model=ParcelSearchResponse)
async def parcels_by_point(lon: Lon, lat: Lat, client: httpx.AsyncClient = Depends(http_client)) -> ParcelSearchResponse:
    """Działka zawierająca punkt wskazany na mapie (EPSG:4326), z geometrią."""
    try:
        parcel, _ = await parcels.get_parcel_by_point(client, lon, lat)
    except (NoData, SourceError) as exc:
        return ParcelSearchResponse(status=source_status(exc), reason=str(exc))
    return _parcel_response(parcel)


@router.get("/parcels/by-id", response_model=ParcelSearchResponse)
async def parcels_by_id(id: ParcelId, client: httpx.AsyncClient = Depends(http_client)) -> ParcelSearchResponse:
    """Działka po pełnym identyfikatorze, z geometrią."""
    try:
        parcel, _ = await parcels.get_parcel_by_id(client, id)
    except (NoData, SourceError) as exc:
        return ParcelSearchResponse(status=source_status(exc), reason=str(exc))
    return _parcel_response(parcel)
