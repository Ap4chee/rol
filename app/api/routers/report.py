"""Raport dla działki i lista upraw do formularza."""
from __future__ import annotations

from fastapi import APIRouter, Depends

from app.api.deps import report_builder
from app.core.crops import CROPS
from app.schemas import CropKey, CropOption, ReportRequest, ReportResponse
from app.services.report_builder import ReportBuilder

router = APIRouter(prefix="/api")


@router.get("/crops", response_model=list[CropOption])
async def crops() -> list[CropOption]:
    """Lista upraw do wyboru w formularzu."""
    return [CropOption(key=CropKey(key), name=crop.name) for key, crop in CROPS.items()]


@router.post("/report", response_model=ReportResponse)
async def report(request: ReportRequest, builder: ReportBuilder = Depends(report_builder)) -> ReportResponse:
    """Raport dla działki (identyfikator albo punkt), uprawy i daty. Liczony na żywo."""
    return await builder.build(request)
