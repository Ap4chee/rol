"""Typy wspólne dla całego API: status źródła i sekcji, klucz uprawy, punkt, wpis o źródle danych."""
from __future__ import annotations

from datetime import date as Date
from enum import Enum

from pydantic import BaseModel, Field, model_validator

from app.config import POLAND_LAT_MAX, POLAND_LAT_MIN, POLAND_LON_MAX, POLAND_LON_MIN
from app.core.crops import CROPS, Crop, with_season_dates


class Status(str, Enum):
    ok = "ok"            # dane są i weszły do obliczeń
    no_data = "no_data"  # źródło odpowiedziało, ale nie ma danych dla tej działki lub daty
    error = "error"      # źródło nie odpowiedziało (błąd, limit zapytań, przekroczony czas)
    pending = "pending"  # liczone osobno, wynik pod adresem z pola `endpoint` (teren; satelita na wolnym łączu)


class CropKey(str, Enum):
    winter_wheat = "winter_wheat"        # pszenica ozima
    spring_barley = "spring_barley"      # jęczmień jary
    winter_rapeseed = "winter_rapeseed"  # rzepak ozimy
    maize = "maize"                      # kukurydza
    potato = "potato"                    # ziemniak
    sugar_beet = "sugar_beet"            # burak cukrowy
    grassland = "grassland"              # użytki zielone


class Point(BaseModel):
    """Punkt w EPSG:4326."""
    lon: float = Field(ge=POLAND_LON_MIN, le=POLAND_LON_MAX, description="długość geograficzna, stopnie")
    lat: float = Field(ge=POLAND_LAT_MIN, le=POLAND_LAT_MAX, description="szerokość geograficzna, stopnie")


class SourceInfo(BaseModel):
    """Jedno źródło danych użyte (albo nieużyte) w raporcie."""
    key: str = Field(description="uldk | weather | weather_recent | soil | satellite | terrain | hydrology")
    name: str = Field(description="nazwa źródła i dostawcy")
    status: Status
    reason: str | None = Field(default=None, description="powód braku danych lub błędu; uwaga przy statusie ok")
    impact: str | None = Field(default=None, description="jak brak tego źródła ogranicza wniosek")
    resolution: str | None = Field(default=None, description="rozdzielczość przestrzenna danych")
    data_from: Date | None = None
    data_to: Date | None = None
    data_date: str | None = Field(default=None, description="data danych słownie, gdy nie jest to zakres dni")
    license: str | None = None
    url: str | None = None
    from_cache: bool = False
    elapsed_s: float | None = Field(default=None, description="czas pobrania w sekundach")
    notes: list[str] = []


class CropTimelineInput(BaseModel):
    crop: CropKey
    sowing_date: Date | None = Field(default=None, description="siew lub sadzenie analizowanej uprawy")
    harvest_date: Date | None = Field(default=None, description="rzeczywisty lub planowany zbiór w tym samym sezonie")
    next_sowing_date: Date | None = Field(default=None, description="kolejny siew po zbiorze, do oceny okrywy pożniwnej")

    def crop_with_timeline(self) -> Crop:
        return with_season_dates(CROPS[self.crop.value], self.sowing_date, self.harvest_date, self.next_sowing_date)

    @model_validator(mode="after")
    def _validate_timeline(self) -> CropTimelineInput:
        self.crop_with_timeline()
        return self
