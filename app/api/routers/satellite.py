"""Komplet obserwacji satelitarnych, gdy nie zdążyły się wczytać razem z raportem (wolne łącze do archiwum)."""
from __future__ import annotations

from datetime import date as Date

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import ValidationError

from app.api.deps import report_builder
from app.api.validators import ParcelId
from app.config import SATELLITE_DEFERRED_BUDGET_S
from app.schemas import CropKey, ReportRequest, SatelliteResponse
from app.services.report_builder import ReportBuilder

router = APIRouter(prefix="/api")


@router.get("/satellite", response_model=SatelliteResponse)
async def satellite(parcel_id: ParcelId, crop: CropKey = Query(), date: Date = Query(),
                    sowing_date: Date | None = None, harvest_date: Date | None = None,
                    next_sowing_date: Date | None = None,
                    builder: ReportBuilder = Depends(report_builder)) -> SatelliteResponse:
    """Pogoda, gleba i działka są już w pamięci podręcznej, więc bilans potrzebny do oceny zgodności liczy się od razu."""
    try:
        request = ReportRequest(parcel_id=parcel_id, crop=crop, date=date, sowing_date=sowing_date,
                                harvest_date=harvest_date, next_sowing_date=next_sowing_date)
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=exc.errors()[0]["msg"]) from exc
    full = await builder.build(request, satellite_budget_s=SATELLITE_DEFERRED_BUDGET_S)
    source = next((s for s in full.sources if s.key == "satellite"), None)
    checks = [r for r in full.recommendations.field_checks if r.key == "satellite_divergence"]
    return SatelliteResponse(satellite=full.satellite, source=source, field_checks=checks)
