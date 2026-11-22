"""Wejście i wyjście `POST /api/report` oraz lista upraw do formularza."""
from __future__ import annotations

from datetime import date as Date
from datetime import datetime as DateTime

from pydantic import BaseModel, Field, model_validator

from app.schemas.common import CropKey, CropTimelineInput, Point, SourceInfo
from app.schemas.observations import (
    HydrologySection,
    IrrigationNeed,
    Recommendations,
    SatelliteSection,
    SoilMoistureSection,
    SoilSection,
    TerrainRef,
)
from app.schemas.parcels import ParcelInfo
from app.schemas.water import CausesSection, CropInfo, HistorySection, WaterStatus


class ReportRequest(CropTimelineInput):
    parcel_id: str | None = Field(
        default=None, description="pełny identyfikator działki, np. 060910_2.0011.580/2", max_length=80)
    point: Point | None = Field(default=None, description="punkt wskazany na mapie (zamiast identyfikatora)")
    date: Date = Field(description="dzień analizy; dane późniejsze niż ta data nie wchodzą do obliczeń")

    @model_validator(mode="after")
    def _one_of_parcel_or_point(self) -> ReportRequest:
        if bool(self.parcel_id) == bool(self.point):
            raise ValueError("Podaj identyfikator działki albo punkt na mapie (dokładnie jedno z dwojga).")
        return self


class ReportResponse(BaseModel):
    schema_version: str = "1.0"
    generated_at: DateTime
    elapsed_s: float
    request: ReportRequest
    analysis_date: Date
    parcel: ParcelInfo | None = None
    crop: CropInfo
    summary: list[str] = Field(default=[], description="najważniejsze wnioski, 2–4 zdania")
    # kolejność sekcji raportu jest narzucona: sytuacja wodna, przyczyny, rekomendacje
    # (retencja, agrotechnika, nawadnianie), potem źródła i ograniczenia
    water_status: WaterStatus
    satellite: SatelliteSection
    history: HistorySection
    causes: CausesSection
    soil: SoilSection
    soil_moisture: SoilMoistureSection | None = None
    irrigation_need: IrrigationNeed | None = None
    terrain: TerrainRef
    hydrology: HydrologySection
    recommendations: Recommendations
    limitations: list[str] = []
    sources: list[SourceInfo] = []
    timings_s: dict[str, float] = {}


class CropOption(BaseModel):
    key: CropKey
    name: str
