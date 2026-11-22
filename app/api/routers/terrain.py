"""Teren i spływ wody dla działki: spadek, drogi spływu, punkty dopływu i odpływu, wnioski."""
from __future__ import annotations

import httpx
from fastapi import APIRouter, Depends

from app.api.deps import http_client, terrain_jobs
from app.api.validators import ParcelId
from app.presentation.sections.terrain import parcel_failure
from app.schemas import TerrainResponse
from app.services.terrain_jobs import TerrainJobs
from app.sources import NoData, SourceError, parcels

router = APIRouter(prefix="/api")


@router.get("/terrain", response_model=TerrainResponse)
async def terrain(parcel_id: ParcelId, client: httpx.AsyncClient = Depends(http_client),
                  jobs: TerrainJobs = Depends(terrain_jobs)) -> TerrainResponse:
    """Teren i spływ wody dla działki: spadek, drogi spływu, punkty dopływu i odpływu, wnioski.

    Liczone osobno, bo wycinek numerycznego modelu terenu z WCS GUGiK trwa kilkanaście do kilkudziesięciu sekund."""
    try:
        parcel, _ = await parcels.get_parcel_by_id(client, parcel_id)
    except (NoData, SourceError) as exc:
        return parcel_failure(parcel_id, str(exc))
    return await jobs.get(parcel)
