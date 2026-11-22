"""Pobranie wszystkich źródeł raportu równolegle, każde z limitem czasu i własnym wpisem w tabeli źródeł.

Awaria pojedynczego źródła nie przerywa raportu: wraca None i SourceInfo z powodem i wpływem na wniosek.
Jedyny wyjątek to działka: bez niej i bez wskazanego punktu nie ma czego liczyć (ParcelNotFound, ParcelSourceDown).
"""
from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import date

import httpx
from shapely.geometry import Point as ShapelyPoint
from shapely.geometry.base import BaseGeometry

from app.config import HISTORY_YEARS, TIMEOUT_SOIL_TOTAL_S
from app.core.dates import AnalysisWindow
from app.infra.http import new_client
from app.presentation.sections import sources_info
from app.schemas import ReportRequest, SourceInfo, Status
from app.services.errors import ParcelNotFound, ParcelSourceDown
from app.sources import (
    NoData,
    SourceError,
    ifs_forecast,
    imgw_hydro,
    mphp,
    parcels,
    sentinel,
    soilgrids,
    weather,
)
from app.sources import soil_moisture as moisture_source

log = logging.getLogger(__name__)

ProgressFn = Callable[[str, str], None]
TIMEOUT_HYDRO_TOTAL_S = 20.0
TIMEOUT_WATERCOURSE_S = 20.0
# źródło pobierane równolegle → etap pokazywany rolnikowi w trakcie liczenia
PROGRESS_STAGE = {"weather": "weather", "soil": "soil", "hydrology": "water"}
NO_FORECAST_FOR_PAST = "Prognoza zapasu jest liczona tylko dla analizy na dziś."


@dataclass
class SatelliteJob:
    """Odczyt zdjęć w wątku, uruchomiony zaraz po poznaniu działki. None, gdy raport jest dla samego punktu."""
    task: asyncio.Task | None
    started_at: float


@dataclass
class SourceBundle:
    """Wszystko, co przyszło ze źródeł, razem z wpisami do tabeli źródeł. None = źródło nie dało danych."""
    parcel: parcels.Parcel | None
    lon: float   # środek działki albo wskazany punkt, EPSG:4326
    lat: float
    weather: weather.WeatherResult
    soil: soilgrids.SoilData | None
    hydrology: imgw_hydro.HydroResult | None
    watercourse: mphp.Watercourse | None
    moisture: dict[str, dict[date, float]] | None
    forecast: weather.DashboardForecast | None
    forecast_reason: str | None
    ifs: ifs_forecast.IfsForecast | None
    ifs_reason: str | None
    parcel_info: SourceInfo
    soil_info: SourceInfo
    hydrology_info: SourceInfo
    watercourse_info: SourceInfo
    moisture_info: SourceInfo
    satellite: SatelliteJob
    timings: dict[str, float] = field(default_factory=dict)


class SourceGatherer:
    """Zbiera źródła dla jednego raportu. `start_terrain` uruchamia w tle liczenie terenu dla znanej działki."""

    def __init__(self, client_factory: Callable[[], httpx.AsyncClient] = new_client,
                 start_terrain: Callable[[parcels.Parcel], None] | None = None) -> None:
        self._client_factory = client_factory
        self._start_terrain = start_terrain

    async def gather(self, request: ReportRequest, window: AnalysisWindow, today: date,
                     satellite_budget_s: float, progress: ProgressFn) -> SourceBundle:
        timings: dict[str, float] = {}
        async with self._client_factory() as client:
            t0 = time.perf_counter()
            progress("parcel", "running")
            parcel, parcel_info = await self.resolve_parcel(client, request)
            progress("parcel", "done")
            progress("satellite", "running" if parcel is not None else "skipped")
            for stage in ("weather", "soil", "water"):
                progress(stage, "running")
            timings["uldk"] = round(time.perf_counter() - t0, 2)
            lon, lat = parcel.centroid_lonlat if parcel else (request.point.lon, request.point.lat)
            geometry = parcel.geometry if parcel else ShapelyPoint(lon, lat)

            satellite = self._start_satellite(parcel, request.date, today, satellite_budget_s)
            if parcel is not None and self._start_terrain is not None:
                self._start_terrain(parcel)   # NMT liczy się w tle; frontend dociąga wynik osobnym zapytaniem

            async def timed(name: str, coro: Awaitable):
                started_at = time.perf_counter()
                result = await coro
                timings[name] = round(time.perf_counter() - started_at, 2)
                if name in PROGRESS_STAGE:
                    progress(PROGRESS_STAGE[name], "done")
                return result

            for_today = request.date >= today
            t0 = time.perf_counter()
            weather_result, (soil, soil_info), (hydro, hydro_info), (watercourse, watercourse_info), \
                (moisture, moisture_info), (forecast, forecast_reason), (ifs, ifs_reason) = await asyncio.gather(
                    timed("weather", weather.fetch_weather(client, lat, lon, window.start, window.end, today)),
                    timed("soil", self.fetch_soil(client, geometry)),
                    timed("hydrology", self.fetch_hydrology(client, lon, lat, request.date, today)),
                    timed("watercourses", self.fetch_watercourse(client, geometry)),
                    timed("soil_moisture", self.fetch_moisture(client, lat, lon, window.start, window.end)),
                    timed("forecast", self.fetch_forecast(client, lat, lon, today) if for_today
                          else _constant((None, NO_FORECAST_FOR_PAST))),
                    # data historyczna: model wilgotności nie działa z zasady, bez ramki w raporcie
                    timed("ifs_forecast", self.fetch_ifs(client, lat, lon, today) if for_today
                          else _constant((None, None))))
            timings["sources_parallel"] = round(time.perf_counter() - t0, 2)
        return SourceBundle(
            parcel=parcel, lon=lon, lat=lat, weather=weather_result, soil=soil, hydrology=hydro,
            watercourse=watercourse, moisture=moisture, forecast=forecast, forecast_reason=forecast_reason,
            ifs=ifs, ifs_reason=ifs_reason, parcel_info=parcel_info, soil_info=soil_info, hydrology_info=hydro_info,
            watercourse_info=watercourse_info, moisture_info=moisture_info, satellite=satellite, timings=timings)

    @staticmethod
    def _start_satellite(parcel: parcels.Parcel | None, day: date, today: date, budget_s: float) -> SatelliteJob:
        """Zdjęcia satelitarne czytamy w wątku od razu po poznaniu działki, równolegle z resztą źródeł."""
        started_at = time.perf_counter()
        if parcel is None:
            return SatelliteJob(None, started_at)
        task = asyncio.create_task(asyncio.to_thread(
            sentinel.observe, parcel.id, parcel.geometry, day, today, budget_s))
        return SatelliteJob(task, started_at)

    async def resolve_parcel(self, client: httpx.AsyncClient,
                             request: ReportRequest) -> tuple[parcels.Parcel | None, SourceInfo]:
        """Działka z ULDK. Przy awarii ULDK i podanym punkcie raport powstaje dla samego punktu."""
        t0 = time.perf_counter()
        info = sources_info.parcel_source()
        try:
            if request.parcel_id:
                parcel, from_cache = await parcels.get_parcel_by_id(client, request.parcel_id)
            else:
                parcel, from_cache = await parcels.get_parcel_by_point(client, request.point.lon, request.point.lat)
        except NoData as exc:
            raise ParcelNotFound(str(exc)) from exc
        except (SourceError, RuntimeError) as exc:
            if request.point is None:
                raise ParcelSourceDown(
                    f"Nie udało się pobrać działki z ULDK ({exc}). Spróbuj ponownie albo wskaż punkt na mapie.") from exc
            info.status, info.reason, info.impact = Status.error, str(exc), sources_info.PARCEL_POINT_ONLY_IMPACT
            info.elapsed_s = round(time.perf_counter() - t0, 2)
            return None, info
        if parcel.source == "egib_wfs":
            sources_info.mark_parcel_fallback(info)
        info.from_cache = from_cache
        info.elapsed_s = round(time.perf_counter() - t0, 2)
        return parcel, info

    @staticmethod
    async def fetch_soil(client: httpx.AsyncClient, geometry: BaseGeometry) -> tuple[soilgrids.SoilData | None, SourceInfo]:
        t0 = time.perf_counter()
        info = sources_info.soil_source()
        impact = sources_info.SOIL_ASSUMED_IMPACT
        data: soilgrids.SoilData | None = None
        try:
            data = await asyncio.wait_for(soilgrids.fetch_soil(client, geometry), TIMEOUT_SOIL_TOTAL_S)
            sources_info.describe_soil(info, data)
        except NoData as exc:
            info.status, info.reason, info.impact = Status.no_data, str(exc), impact
        except TimeoutError:
            info.status, info.impact = Status.error, impact
            info.reason = f"SoilGrids nie odpowiedział w {TIMEOUT_SOIL_TOTAL_S:.0f} s."
        except (SourceError, RuntimeError) as exc:
            info.status, info.reason, info.impact = Status.error, str(exc), impact
        info.elapsed_s = round(time.perf_counter() - t0, 2)
        return data, info

    @staticmethod
    async def fetch_hydrology(client: httpx.AsyncClient, lon: float, lat: float, analysis_date: date,
                              today: date) -> tuple[imgw_hydro.HydroResult | None, SourceInfo]:
        """Najbliższy wodowskaz IMGW i porównanie z tymi samymi dniami w poprzednich latach."""
        t0 = time.perf_counter()
        info = sources_info.hydrology_source()
        impact = sources_info.HYDRO_NO_IMPACT
        result = None
        try:
            result = await asyncio.wait_for(
                imgw_hydro.fetch_hydrology(client, lon, lat, analysis_date, today, HISTORY_YEARS), TIMEOUT_HYDRO_TOTAL_S)
            sources_info.describe_hydrology(info, result)
        except NoData as exc:
            info.status, info.reason, info.impact = Status.no_data, str(exc), impact
        except TimeoutError:
            info.status, info.impact = Status.error, impact
            info.reason = f"Dane IMGW nie przyszły w {TIMEOUT_HYDRO_TOTAL_S:.0f} s."
        except (SourceError, RuntimeError) as exc:
            info.status, info.reason, info.impact = Status.error, str(exc), impact
        info.elapsed_s = round(time.perf_counter() - t0, 2)
        return result, info

    @staticmethod
    async def fetch_watercourse(client: httpx.AsyncClient,
                                geometry: BaseGeometry) -> tuple[mphp.Watercourse | None, SourceInfo]:
        """Najbliższy ciek z mapy MPHP10k."""
        t0 = time.perf_counter()
        info = sources_info.watercourse_source()
        impact = sources_info.WATERCOURSE_NO_IMPACT
        result = None
        try:
            result, info.from_cache = await asyncio.wait_for(
                mphp.fetch_nearest_watercourse(client, geometry), TIMEOUT_WATERCOURSE_S)
        except TimeoutError:
            info.status, info.impact = Status.error, impact
            info.reason = f"Mapa cieków nie odpowiedziała w {TIMEOUT_WATERCOURSE_S:.0f} s."
        except (SourceError, RuntimeError) as exc:
            info.status, info.reason, info.impact = Status.error, str(exc), impact
        info.elapsed_s = round(time.perf_counter() - t0, 2)
        return result, info

    @staticmethod
    async def fetch_moisture(client: httpx.AsyncClient, lat: float, lon: float, start: date, end: date
                             ) -> tuple[dict[str, dict[date, float]] | None, SourceInfo]:
        """Wilgotność warstw gleby w okolicy z NASA POWER."""
        t0 = time.perf_counter()
        info = sources_info.moisture_source_info()
        impact = sources_info.MOISTURE_NO_IMPACT
        series = None
        try:
            series, from_cache = await moisture_source.fetch(client, lat, lon, start, end)
            sources_info.describe_moisture(info, series, from_cache)
        except NoData as exc:
            info.status, info.reason, info.impact = Status.no_data, str(exc), impact
        except (SourceError, RuntimeError) as exc:
            info.status, info.reason, info.impact = Status.error, str(exc), impact
        info.elapsed_s = round(time.perf_counter() - t0, 2)
        return series, info

    @staticmethod
    async def fetch_forecast(client: httpx.AsyncClient, lat: float, lon: float,
                             today: date) -> tuple[weather.DashboardForecast | None, str | None]:
        """Prognoza Open-Meteo do 16 dni; błąd zwraca powód zamiast przerywać raport."""
        try:
            return await weather.fetch_dashboard_forecast(client, lat, lon, today, days=weather.FORECAST_MAX_DAYS), None
        except (NoData, SourceError) as exc:
            return None, f"Brak prognozy pogody: {exc}"

    @staticmethod
    async def fetch_ifs(client: httpx.AsyncClient, lat: float, lon: float,
                        today: date) -> tuple[ifs_forecast.IfsForecast | None, str | None]:
        """Prognoza ECMWF IFS (wejście modelu wilgotności); błąd zwraca powód zamiast przerywać raport."""
        try:
            return (await ifs_forecast.fetch(client, lat, lon, today))[0], None
        except (NoData, SourceError) as exc:
            return None, f"Brak prognozy ECMWF IFS: {exc}"

    @staticmethod
    async def finish_satellite(job: SatelliteJob) -> tuple[sentinel.SatelliteResult | None, SourceInfo]:
        """Odbiera wynik odczytu zdjęć. Błąd nie przerywa raportu."""
        info = sources_info.satellite_source()
        impact = sources_info.SATELLITE_NO_IMPACT
        if job.task is None:
            info.status, info.impact = Status.no_data, impact
            info.reason = "Brak granicy działki (raport dla punktu), więc nie ma czego wyciąć ze zdjęć."
            return None, info
        result: sentinel.SatelliteResult | None = None
        try:
            result = await job.task
            sources_info.describe_satellite(info, result)
        except (SourceError, NoData) as exc:
            info.status, info.reason, info.impact = Status.error, str(exc), impact
        except Exception as exc:  # odczyt rastrów w wątku może zgłosić dowolny wyjątek biblioteki
            log.warning("Odczyt zdjęć satelitarnych się nie udał", exc_info=exc)
            info.status, info.impact = Status.error, impact
            info.reason = f"Błąd odczytu zdjęć satelitarnych ({type(exc).__name__})."
        info.elapsed_s = round(time.perf_counter() - job.started_at, 2)
        return result, info


async def _constant(value):
    return value
