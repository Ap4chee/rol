"""Kontrakt API: wejście i wyjście `POST /api/report` oraz `GET /api/terrain`.

Zasada: frontend tylko rysuje to, co dostał. Każda sekcja ma `status` i `reason`,
a każde źródło danych osobny wpis w `sources` (status, powód, nazwa, rozdzielczość, data danych).
Jednostki są w nazwach pól (`_mm`, `_pct`, `_ha`, `_m`). Współrzędne w odpowiedzi: EPSG:4326 (lon, lat).
"""
from __future__ import annotations

from datetime import date as Date, datetime as DateTime
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field, model_validator


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


# ---------- wejście ----------

class Point(BaseModel):
    """Punkt w EPSG:4326."""
    lon: float = Field(ge=14.0, le=24.3, description="długość geograficzna, stopnie")
    lat: float = Field(ge=48.9, le=55.0, description="szerokość geograficzna, stopnie")


class ReportRequest(BaseModel):
    parcel_id: str | None = Field(
        default=None, description="pełny identyfikator działki, np. 060910_2.0011.580/2", max_length=80)
    point: Point | None = Field(default=None, description="punkt wskazany na mapie (zamiast identyfikatora)")
    crop: CropKey
    date: Date = Field(description="dzień analizy; dane późniejsze niż ta data nie wchodzą do obliczeń")

    @model_validator(mode="after")
    def _one_of_parcel_or_point(self) -> "ReportRequest":
        if bool(self.parcel_id) == bool(self.point):
            raise ValueError("Podaj identyfikator działki albo punkt na mapie (dokładnie jedno z dwojga).")
        return self


# ---------- wspólne ----------

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


class ParcelInfo(BaseModel):
    id: str
    number: str | None = None
    region: str | None = Field(default=None, description="obręb")
    commune: str | None = None
    county: str | None = None
    voivodeship: str | None = None
    area_ha: float
    centroid: Point
    geometry: dict[str, Any] = Field(description="GeoJSON Polygon/MultiPolygon, EPSG:4326")
    bbox: list[float] = Field(description="[lon_min, lat_min, lon_max, lat_max], EPSG:4326")


class ParcelCandidate(BaseModel):
    id: str
    number: str | None = None
    region: str | None = None
    commune: str | None = None
    county: str | None = None
    voivodeship: str | None = None


class ParcelSearchResponse(BaseModel):
    status: Status
    reason: str | None = None
    candidates: list[ParcelCandidate] = []
    truncated: bool = False
    parcel: ParcelInfo | None = Field(default=None, description="pełne dane działki z geometrią (by-point, by-id)")


# ---------- uprawa ----------

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
    depletion_fraction_p: float | None = None
    season_from: Date | None = None
    season_to: Date | None = None
    critical_from: Date | None = None
    critical_to: Date | None = None
    parameters: list[CropParameter] = []
    assumptions: list[str] = []


# ---------- 1. sytuacja wodna ----------

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
    text: list[str] = []


# ---------- 2. przyczyny ----------

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


# ---------- podatność historyczna ----------

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
    seasons_with_stress: int | None = None
    seasons_total: int | None = None
    same_day_current_pct: float | None = None
    same_day_median_pct: float | None = None
    same_day_drier_years: int | None = None
    same_day_years: int | None = None
    text: list[str] = []


# ---------- satelita ----------

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


# ---------- teren i spływ (osobny endpoint) ----------

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


# ---------- hydrologia ----------

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


# ---------- gleba ----------

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


# ---------- zapotrzebowanie na nawadnianie ----------

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
    monthly: list[MonthAmount] = Field(default=[], description="mediana na miesiąc w kolejności sezonu")
    text: list[str] = []


# ---------- rekomendacje ----------

class Recommendations(BaseModel):
    status: Status
    reason: str | None = None
    retention: list[Recommendation] = []
    agrotechnical: list[Recommendation] = []
    irrigation: list[Recommendation] = []
    field_checks: list[Recommendation] = Field(
        default=[], description="co sprawdzić na polu, gdy dane nie rozstrzygają")
    irrigation_note: str | None = None


# ---------- raport ----------

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


class ForecastDay(BaseModel):
    date: Date
    temperature_max_c: float | None = None
    precipitation_mm: float | None = None
    et0_mm: float | None = None
    weather_code: int | None = None


class ForecastResponse(BaseModel):
    status: Status
    reason: str | None = None
    days: list[ForecastDay] = []
    last_wet_day: Date | None = None
    past_days_complete: bool = False
