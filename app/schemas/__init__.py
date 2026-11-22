"""Kontrakt API: wejście i wyjście `POST /api/report` oraz `GET /api/terrain`.

Zasada: frontend tylko rysuje to, co dostał. Każda sekcja ma `status` i `reason`,
a każde źródło danych osobny wpis w `sources` (status, powód, nazwa, rozdzielczość, data danych).
Jednostki są w nazwach pól (`_mm`, `_pct`, `_ha`, `_m`). Współrzędne w odpowiedzi: EPSG:4326 (lon, lat).

Typy są podzielone na moduły według obszaru; tu wszystkie są dostępne pod `app.schemas`.
"""
from __future__ import annotations

from app.schemas.common import CropKey, CropTimelineInput, Point, SourceInfo, Status  # noqa: F401
from app.schemas.fields import FieldInput, SavedField  # noqa: F401
from app.schemas.forecast import (  # noqa: F401
    FieldworkDay,
    FieldworkRating,
    FieldworkResponse,
    FieldworkWindow,
    ForecastDay,
    ForecastResponse,
)
from app.schemas.observations import (  # noqa: F401
    HydrologySection,
    HydroYear,
    IrrigationNeed,
    LandUseClass,
    LandUseSection,
    MonthAmount,
    NdmiForecast,
    Recommendation,
    Recommendations,
    SatelliteObservation,
    SatelliteResponse,
    SatelliteSection,
    SoilLayer,
    SoilMoistureLayer,
    SoilMoistureSection,
    SoilSection,
    TerrainRef,
    TerrainResponse,
)
from app.schemas.parcels import AddressMatch, AddressQuery, ParcelCandidate, ParcelInfo, ParcelSearchResponse  # noqa: F401
from app.schemas.report import CropOption, ReportRequest, ReportResponse  # noqa: F401
from app.schemas.water import (  # noqa: F401
    BalanceVariant,
    Cause,
    CausesSection,
    ClimaticWaterBalance,
    CropInfo,
    CropParameter,
    DailyPoint,
    ForecastPoint,
    HistorySection,
    MlForecast,
    MlForecastPoint,
    SeasonStress,
    SeasonSummary,
    WaterStatus,
    WeatherWindow,
)
