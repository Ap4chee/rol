"""Składanie raportu z wyników poszczególnych źródeł i obliczeń.

Szkielet kontraktu: sekcje są jeszcze niepodłączone i mówią to wprost w polu `reason`.
"""
from __future__ import annotations

import time
from datetime import datetime, timezone

from app.schemas import (
    CausesSection,
    CropInfo,
    HistorySection,
    HydrologySection,
    Recommendations,
    ReportRequest,
    ReportResponse,
    SatelliteSection,
    SoilSection,
    Status,
    TerrainRef,
    WaterStatus,
)

NOT_CONNECTED = "Sekcja nie jest jeszcze podłączona (szkielet kontraktu)."


async def build_report(request: ReportRequest) -> ReportResponse:
    started = time.perf_counter()
    from app.main import CROP_NAMES  # import lokalny: unika cyklu przy starcie

    return ReportResponse(
        generated_at=datetime.now(timezone.utc),
        elapsed_s=round(time.perf_counter() - started, 3),
        request=request,
        analysis_date=request.date,
        parcel=None,
        crop=CropInfo(key=request.crop, name=CROP_NAMES[request.crop], in_season=False),
        water_status=WaterStatus(status=Status.no_data, reason=NOT_CONNECTED),
        satellite=SatelliteSection(status=Status.no_data, reason=NOT_CONNECTED),
        history=HistorySection(status=Status.no_data, reason=NOT_CONNECTED),
        causes=CausesSection(status=Status.no_data, reason=NOT_CONNECTED),
        soil=SoilSection(status=Status.no_data, reason=NOT_CONNECTED),
        terrain=TerrainRef(status=Status.no_data, reason=NOT_CONNECTED),
        hydrology=HydrologySection(status=Status.no_data, reason=NOT_CONNECTED),
        recommendations=Recommendations(status=Status.no_data, reason=NOT_CONNECTED),
        limitations=[NOT_CONNECTED],
    )
