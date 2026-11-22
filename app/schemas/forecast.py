"""Prognoza pogody na pulpit i plan prac polowych na 7 dni."""
from __future__ import annotations

from datetime import date as Date

from pydantic import BaseModel, Field

from app.schemas.common import CropKey, Status


class ForecastDay(BaseModel):
    date: Date
    temperature_max_c: float | None = None
    temperature_min_c: float | None = None
    precipitation_mm: float | None = None
    et0_mm: float | None = None
    weather_code: int | None = None
    wind_max_kmh: float | None = Field(default=None, description="największa prędkość wiatru w ciągu doby, 10 m [km/h]")


class ForecastResponse(BaseModel):
    status: Status
    reason: str | None = None
    days: list[ForecastDay] = []
    recent: list[ForecastDay] = Field(default=[], description="30 dni przed dziś (opad, ET0) do bilansu wierzchu gleby")
    last_wet_day: Date | None = None
    past_days_complete: bool = False


class FieldworkRating(BaseModel):
    rating: str = Field(description="good | caution | avoid | off (poza sezonem tej pracy)")
    reason: str


class FieldworkDay(BaseModel):
    date: Date
    rain_mm: float | None = None
    wind_max_kmh: float | None = None
    temperature_max_c: float | None = None
    temperature_min_c: float | None = None
    weather_code: int | None = Field(default=None, description="kod pogody WMO (Open-Meteo) do ikony dnia")
    surface_fc_pct: float | None = Field(default=None, description="wilgotność wierzchu 0–10 cm rano, % pojemności polowej")
    traffic: FieldworkRating
    sowing: FieldworkRating
    spraying: FieldworkRating
    fertilizing: FieldworkRating


class FieldworkWindow(BaseModel):
    date_from: Date
    date_to: Date


class FieldworkResponse(BaseModel):
    status: Status
    reason: str | None = None
    crop: CropKey | None = None
    soil_assumed: bool = False
    days: list[FieldworkDay] = []
    windows: dict[str, FieldworkWindow] = Field(default={}, description="najdłuższy ciąg dobrych dni dla każdej pracy")
    notes: list[str] = []
