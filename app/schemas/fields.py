"""Pola rolnika zapisane na serwerze; raport liczy worker w tle (app/services/field_worker.py)."""
from __future__ import annotations

from datetime import date as Date
from datetime import datetime as DateTime
from typing import Any

from pydantic import BaseModel, Field, model_validator

from app.schemas.common import CropTimelineInput, Point


class FieldInput(CropTimelineInput):
    """Co liczyć dla pola. Raport powstaje w tle po zapisaniu pola i odświeża się raz na dobę."""
    name: str = Field(default="", max_length=80)
    parcel_id: str | None = Field(default=None, min_length=5, max_length=80)
    point: Point | None = None
    date: Date | None = Field(default=None, description="dzień analizy; brak = zawsze dzisiejszy dzień")
    test: bool = Field(default=False, description="tryb testowy frontendu: raport dla punktu, obrys rysuje frontend")

    @model_validator(mode="after")
    def _one_of_parcel_or_point(self) -> FieldInput:
        if bool(self.parcel_id) == bool(self.point):
            raise ValueError("Podaj identyfikator działki albo punkt na mapie (dokładnie jedno z dwojga).")
        return self


class SavedField(BaseModel):
    id: str
    name: str
    input: FieldInput
    job: str = Field(description="queued (czeka) | running (liczy się) | ok | error (ostatnie liczenie się nie udało)")
    error: str | None = Field(default=None, description="powód nieudanego liczenia; worker ponowi je sam")
    report: dict[str, Any] | None = Field(default=None, description="ostatni policzony raport (ReportResponse)")
    refreshed_at: DateTime | None = Field(default=None, description="kiedy policzono raport w `report`")
    progress: dict[str, str] | None = Field(default=None, description=(
        "tylko gdy job = running: etap liczenia → running | done | skipped; etapy: parcel, weather, soil, water, "
        "balance, satellite, recommendations (źródła pobierają się równolegle, więc kilka etapów trwa naraz)"))
