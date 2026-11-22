"""Sekcje raportu z obserwacji wokół bilansu: satelita, teren, hydrologia, gleba i rekomendacje."""
from __future__ import annotations

from datetime import date as Date
from typing import Any

from pydantic import BaseModel, Field

from app.schemas.common import Point, SourceInfo, Status
from app.schemas.water import Cause


class SatelliteObservation(BaseModel):
    scene_id: str
    date: Date
    valid_pixels: int
    total_pixels: int
    coverage_pct: float
    bare_pixels: int = Field(default=0, description="piksele z odkrytą glebą (SCL 5)")
    cloudy_pixels: int = Field(default=0, description="piksele z chmurą albo cieniem chmury")
    accepted: bool = Field(description="czy z tej sceny policzono wskaźniki")
    reject_reason: str | None = None
    ndvi: float | None = None
    ndmi: float | None = None


class NdmiForecast(BaseModel):
    """Prognoza zmiany NDMI na 7–14 dni z modelu ML (kowr_ml). Dodatek do bilansu, nie jego zamiennik."""
    available: bool
    reason: str | None = Field(default=None, description="dlaczego prognozy nie ma")
    status: str | None = Field(default=None, description="status modelu z karty, np. „eksperymentalny”")
    model_run: str | None = None
    window_from: Date | None = None
    window_to: Date | None = None
    ndmi_last: float | None = None
    last_scene_date: Date | None = None
    last_scene_age_days: int | None = None
    delta_p50: float | None = Field(default=None, description="prognozowana zmiana NDMI (mediana)")
    delta_p10: float | None = Field(default=None, description="dolna granica przedziału 80%")
    delta_p90: float | None = Field(default=None, description="górna granica przedziału 80%")
    trend: str | None = Field(default=None, description="down | flat | up: kierunek mediany względem progu zmiany NDMI")
    inputs: dict[str, float | None] = Field(default_factory=dict, description="cechy wejściowe modelu")
    text: list[str] = []


class SatelliteSection(BaseModel):
    status: Status
    reason: str | None = None
    window_from: Date | None = None
    window_to: Date | None = None
    scenes_found: int = 0
    observations: list[SatelliteObservation] = []
    latest: SatelliteObservation | None = None
    ndmi_change: float | None = None
    ndvi_change: float | None = None
    agreement: str | None = Field(default=None, description="confirms | diverges | inconclusive")
    green_cover: bool | None = Field(
        default=None, description="czy najnowsze czyste zdjęcie pokazuje zieloną okrywę (False = odkryta gleba)")
    endpoint: str | None = Field(
        default=None, description="przy statusie pending: adres GET, pod którym frontend dociąga komplet zdjęć")
    ndmi_forecast: NdmiForecast | None = None
    text: list[str] = []


class TerrainRef(BaseModel):
    status: Status
    reason: str | None = None
    endpoint: str | None = Field(default=None, description="adres GET, pod którym frontend dociąga wynik terenu")


class Recommendation(BaseModel):
    key: str
    category: str = Field(description="retention | agrotechnical | irrigation | field_check")
    title: str
    what: str = Field(description="co zrobić")
    where: str = Field(description="gdzie")
    why: str = Field(description="dlaczego: wartości policzone dla tej działki")
    confidence: str = Field(description="wysoka | średnia | niska")
    confidence_reason: str
    evidence: dict[str, Any] = {}
    timing: str = Field(default="long_term", description="now | after_harvest | long_term: kiedy działanie wykonać")


class TerrainResponse(BaseModel):
    status: Status
    reason: str | None = None
    parcel_id: str
    source: SourceInfo
    elevation_min_m: float | None = None
    elevation_max_m: float | None = None
    slope_mean_pct: float | None = None
    slope_p90_pct: float | None = None
    threshold_ha: float | None = None
    flow_paths: dict[str, Any] | None = Field(default=None, description="GeoJSON FeatureCollection (LineString), EPSG:4326")
    crossings: dict[str, Any] | None = Field(
        default=None, description="GeoJSON FeatureCollection (Point): kind=inflow|outflow, area_ha, side")
    causes: list[Cause] = []
    recommendations: list[Recommendation] = []
    text: list[str] = []
    limitations: list[str] = []


class SatelliteResponse(BaseModel):
    """Wynik `GET /api/satellite`: komplet obserwacji, gdy nie zdążyły się wczytać razem z raportem."""
    satellite: SatelliteSection
    source: SourceInfo
    field_checks: list[Recommendation] = Field(
        default=[], description="oględziny pola wynikające z rozbieżności zdjęć i bilansu (frontend dopisuje je do listy)")


class HydroYear(BaseModel):
    year: int
    value: float = Field(description="średnia z tych samych 7 dni kalendarzowych w danym roku (jednostka w `unit`)")


class HydrologySection(BaseModel):
    status: Status
    reason: str | None = None
    nearest_watercourse_name: str | None = None
    nearest_watercourse_distance_m: float | None = None
    search_radius_m: float | None = None
    # najbliższy wodowskaz IMGW-PIB i porównanie z tymi samymi dniami w poprzednich latach
    station_id: str | None = None
    station_name: str | None = None
    river: str | None = None
    station_distance_km: float | None = None
    station_location: Point | None = None
    metric: str | None = Field(default=None, description="flow (przepływ) | level (stan wody)")
    unit: str | None = Field(default=None, description="m³/s | cm")
    origin: str | None = Field(default=None, description="archive (średnia z 7 dni) | live (bieżący pomiar)")
    current_value: float | None = None
    current_from: Date | None = None
    current_to: Date | None = None
    years: list[HydroYear] = []
    years_higher: int | None = None
    years_compared: int | None = None
    median_value: float | None = None
    class_key: str | None = Field(default=None, description="very_low | low | normal | high")
    class_label: str | None = None
    text: list[str] = []


class SoilLayer(BaseModel):
    top_cm: int
    bottom_cm: int
    sand_pct: float
    silt_pct: float
    clay_pct: float
    soc_g_kg: float | None = None
    bulk_density_g_cm3: float | None = None
    sand_pct_range: list[float] | None = Field(default=None, description="[Q0.05, Q0.95]")
    clay_pct_range: list[float] | None = None
    texture_key: str = Field(description="klucz ilustracji: sand | sandy_loam | loam | silt_loam | clay")
    texture_usda: str = Field(description="klasa uziarnienia USDA")
    texture_label: str
    image: str | None = None
    field_capacity_vol_pct: float
    wilting_point_vol_pct: float
    available_water_mm: float = Field(description="woda dostępna w tej warstwie przy pełnym nasyceniu do pojemności polowej")


class SoilSection(BaseModel):
    status: Status
    reason: str | None = None
    assumed: bool = False
    cells: int | None = Field(default=None, description="liczba komórek SoilGrids 250 m przeciętych przez działkę")
    method: str | None = None
    root_depth_m: float | None = None
    layers: list[SoilLayer] = []
    text: list[str] = []


class SoilMoistureLayer(BaseModel):
    key: str = Field(description="surface | root_zone | profile")
    label: str
    top_cm: int
    bottom_cm: int | None = Field(default=None, description="None = do skały macierzystej (cały profil modelu)")
    current: float = Field(description="wilgotność względna 0–1, średnia z 7 dni do `current_to`")
    current_to: Date
    median: float = Field(description="mediana z tych samych 7 dni w poprzednich latach")
    years_higher: int = Field(description="w ilu latach wilgotność była wyższa niż teraz")
    years_compared: int
    class_key: str = Field(description="very_low | low | normal | high")
    class_label: str


class SoilMoistureSection(BaseModel):
    """Wilgotność w warstwach z modelu regionalnego (okolica działki, nie sama działka)."""
    status: Status
    reason: str | None = None
    layers: list[SoilMoistureLayer] = []
    text: list[str] = []


class MonthAmount(BaseModel):
    month: int = Field(description="1–12")
    mm: float


class IrrigationNeed(BaseModel):
    """Ile wody trzeba by dodać, żeby zapas nie spadł poniżej progu stresu (FAO-56 rozdz. 8, dawka uzupełnia do pojemności polowej)."""
    status: Status
    reason: str | None = None
    season_label: int | None = Field(default=None, description="rok zbioru bieżącego sezonu")
    season_from: Date | None = None
    so_far_mm: float | None = Field(default=None, description="bieżący sezon do dnia analizy, mm netto")
    so_far_events: int | None = None
    etc_so_far_mm: float | None = None
    rain_so_far_mm: float | None = None
    typical_mm: float | None = Field(default=None, description="mediana pełnych sezonów z 10 lat, mm netto")
    dry_mm: float | None = Field(default=None, description="90. percentyl sezonów (suchy rok), mm netto")
    seasons_compared: int = 0
    seasons_without: int = Field(default=0, description="w ilu sezonach nawadnianie nie było potrzebne")
    dose_mm: float | None = Field(default=None, description="typowa pojedyncza dawka, mm")
    monthly: list[MonthAmount] = Field(default=[], description="średnia na miesiąc w kolejności sezonu")
    text: list[str] = []


class Recommendations(BaseModel):
    status: Status
    reason: str | None = None
    retention: list[Recommendation] = []
    agrotechnical: list[Recommendation] = []
    irrigation: list[Recommendation] = []
    field_checks: list[Recommendation] = Field(
        default=[], description="co sprawdzić na polu, gdy dane nie rozstrzygają")
    irrigation_note: str | None = None
