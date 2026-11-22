"""Sekcje raportu o wodzie: uprawa, sytuacja wodna z prognozą, przyczyny niedoboru i historia 10 sezonów."""
from __future__ import annotations

from datetime import date as Date
from typing import Any

from pydantic import BaseModel, Field

from app.schemas.common import CropKey, Status


class CropParameter(BaseModel):
    name: str
    value: str
    source: str = Field(description="np. 'FAO-56, tab. 12' albo 'założenie dla Polski'")


class CropInfo(BaseModel):
    key: CropKey
    name: str
    in_season: bool = Field(description="czy w dniu analizy uprawa jest w okresie wzrostu")
    stage_key: str | None = Field(default=None, description="initial | development | mid | late | dormant | off_season")
    stage_name: str | None = None
    kc: float | None = Field(default=None, description="współczynnik uprawy w dniu analizy")
    root_depth_m: float | None = None
    root_depth_now_m: float | None = Field(default=None, description="szacowana głębokość korzeni w dniu analizy (FAO-56 rozdz. 8); None poza sezonem")
    depletion_fraction_p: float | None = None
    season_from: Date | None = None
    season_to: Date | None = None
    critical_from: Date | None = None
    critical_to: Date | None = None
    parameters: list[CropParameter] = []
    assumptions: list[str] = []


class BalanceVariant(BaseModel):
    """Wynik bilansu dla jednego wariantu gleby (średnia albo granica przedziału SoilGrids)."""
    key: str = Field(description="mean | light | heavy | assumed")
    label: str
    field_capacity_vol_pct: float
    wilting_point_vol_pct: float
    taw_mm: float = Field(description="woda dostępna ogółem w strefie korzeni")
    raw_mm: float = Field(description="woda łatwo dostępna")
    depletion_mm: float = Field(description="wyczerpanie wody w strefie korzeni w dniu analizy")
    depletion_pct_taw: float
    available_mm: float
    ks: float = Field(description="współczynnik stresu wodnego 0–1 (1 = brak stresu)")
    class_key: str = Field(description="none | watch | moderate | severe")
    class_label: str


class ClimaticWaterBalance(BaseModel):
    days: int
    date_from: Date
    date_to: Date
    rain_mm: float
    et0_mm: float
    balance_mm: float
    median_10y_mm: float | None = None
    years_compared: int = 0
    drier_years: int | None = Field(default=None, description="w ilu z porównywanych lat ten sam okres był suchszy")
    text: str


class DailyPoint(BaseModel):
    date: Date
    rain_mm: float
    et0_mm: float
    etc_mm: float
    depletion_mm: float
    raw_mm: float
    taw_mm: float
    available_pct: float = Field(description="zapas wody dostępnej w strefie korzeni, % TAW")
    stress_threshold_pct: float = Field(description="poniżej tego zapasu [% TAW] uprawa jest w stresie (1 − p)")
    typical_p10_pct: float | None = Field(default=None, description="ten sam dzień w 10 poprzednich latach: 10. percentyl")
    typical_median_pct: float | None = None
    typical_p90_pct: float | None = None


class ForecastPoint(BaseModel):
    date: Date
    rain_mm: float
    et0_mm: float
    available_pct: float
    stress_threshold_pct: float
    typical_p10_pct: float | None = Field(default=None, description="ten sam dzień w 10 poprzednich latach: 10. percentyl")
    typical_median_pct: float | None = None
    typical_p90_pct: float | None = None


class MlForecastPoint(BaseModel):
    date: Date
    available_pct: float = Field(description="zapas działki [% TAW] według modelu wilgotności (mediana)")
    low_pct: float = Field(description="dolna granica przedziału 80%")
    high_pct: float = Field(description="górna granica przedziału 80%")


class MlForecast(BaseModel):
    """Prognoza zapasu modelem ML (kowr_ml, model wilgotności v3): zmiana wilgotności 0–100 cm doczepiona do zapasu z t−1."""
    available: bool
    reason: str | None = None
    model_run: str | None = None
    model_status: str | None = None
    points: list[MlForecastPoint] = []
    text: list[str] = []


class SeasonSummary(BaseModel):
    season: str
    date_from: Date
    date_to: Date
    rain_mm: float
    etc_mm: float
    stress_days: int
    stress_days_critical: int
    longest_stress_run_days: int
    max_depletion_pct_taw: float
    text: str


class WaterStatus(BaseModel):
    status: Status
    reason: str | None = None
    headline: str | None = None
    class_key: str | None = Field(default=None, description="none | watch | moderate | severe")
    class_label: str | None = None
    in_season: bool | None = None
    last_data_day: Date | None = Field(default=None, description="ostatni dzień z danymi pogody w bilansie")
    soil_assumed: bool = Field(default=False, description="True, gdy brak danych o glebie i przyjęto glebę umowną")
    result: BalanceVariant | None = None
    variants: list[BalanceVariant] = []
    spans_classes: bool = False
    uncertainty_text: str | None = None
    climatic_water_balance: ClimaticWaterBalance | None = None
    last_season: SeasonSummary | None = None
    series: list[DailyPoint] = []
    forecast: list[ForecastPoint] = Field(default=[], description="bilans puszczony dalej po prognozie pogody (tylko analiza na dziś)")
    forecast_reason: str | None = Field(default=None, description="dlaczego nie ma prognozy zapasu")
    forecast_stress_day: Date | None = Field(default=None, description="pierwszy dzień prognozy z zapasem poniżej progu stresu")
    ml_forecast: MlForecast | None = Field(default=None, description="prognoza zapasu modelem ML na 14 dni (tylko analiza na dziś)")
    text: list[str] = []


class WeatherWindow(BaseModel):
    days: int
    rain_mm: float
    rain_median_mm: float | None = None
    rain_pct_of_median: float | None = None
    et0_mm: float
    et0_median_mm: float | None = None
    et0_pct_of_median: float | None = None
    years_compared: int = 0


class Cause(BaseModel):
    key: str
    title: str
    text: str
    evidence: dict[str, Any] = {}


class CausesSection(BaseModel):
    status: Status
    reason: str | None = None
    windows: list[WeatherWindow] = []
    items: list[Cause] = []
    not_assessed: list[str] = Field(default=[], description="przyczyny, których nie dało się ocenić, z powodem")


class SeasonStress(BaseModel):
    season: str
    critical_from: Date
    critical_to: Date
    stress_days_critical: int = Field(description="dni z ubytkiem powyżej progu RAW w okresie krytycznym")
    severe_days_critical: int = Field(default=0, description="w tym dni silnego niedoboru (klasa severe)")
    longest_stress_run_days: int
    max_depletion_pct_taw: float
    stressed: bool
    complete: bool = True


class HistorySection(BaseModel):
    status: Status
    reason: str | None = None
    seasons: list[SeasonStress] = []
    seasons_with_stress: int | None = Field(default=None, description="sezony z co najmniej jednym dniem stresu")
    seasons_with_long_stress: int | None = Field(default=None, description="sezony ze stresem co najmniej `long_stress_days` dni")
    long_stress_days: int | None = None
    seasons_total: int | None = None
    same_day_current_pct: float | None = None
    same_day_median_pct: float | None = None
    same_day_drier_years: int | None = None
    same_day_years: int | None = None
    text: list[str] = []
