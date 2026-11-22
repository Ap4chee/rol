"""Składanie raportu: źródła (SourceGatherer) → bilans (app/core) → sekcje (app/presentation).

Kolejność analizy jest narzucona przez zadanie: sytuacja wodna → przyczyny → rekomendacje
(retencja, agrotechnika, nawadnianie). Awaria pojedynczego źródła nie przerywa raportu:
brak jest nazwany w `sources`, a jego wpływ na wniosek opisany.
"""
from __future__ import annotations

import time
from dataclasses import dataclass
from datetime import UTC, date, datetime

from app.config import HISTORY_YEARS, SATELLITE_INLINE_BUDGET_S
from app.core import analysis
from app.core.balance_run import Computed, compute, irrigated_balance
from app.core.dates import AnalysisWindow, analysis_window, today_warsaw
from app.core.soil import assumed_variant, build_variants
from app.presentation.sections import (
    causes,
    crop,
    forecast,
    history,
    hydrology,
    irrigation,
    limitations,
    recommendations,
    satellite,
    soil,
    soil_moisture,
    summary,
)
from app.presentation.sections.parcel import parcel_info
from app.presentation.sections.sources_info import weather_sources
from app.presentation.sections.water_status import water_status
from app.schemas import (
    CausesSection,
    HistorySection,
    IrrigationNeed,
    ReportRequest,
    ReportResponse,
    SoilSection,
    SourceInfo,
    WaterStatus,
)
from app.services import ml_bridge
from app.services.source_gatherer import ProgressFn, SourceBundle, SourceGatherer

# Krótsza seria nie ma nawet roku rozbiegu bilansu, więc oceny niedoboru nie liczymy.
MIN_WEATHER_DAYS = 400


def _no_progress(_stage: str, _state: str) -> None:
    pass


@dataclass
class _Balance:
    """Wyniki części obliczeniowej, z których korzystają dalsze sekcje."""
    computed: Computed
    status: WaterStatus
    history: HistorySection
    causes: CausesSection
    irrigation: IrrigationNeed


class ReportBuilder:
    """Koordynator raportu. Źródła podaje SourceGatherer, więc w testach da się go podmienić na dane bez sieci."""

    def __init__(self, gatherer: SourceGatherer | None = None) -> None:
        self._gatherer = gatherer or SourceGatherer()

    async def build(self, request: ReportRequest, today: date | None = None,
                    satellite_budget_s: float = SATELLITE_INLINE_BUDGET_S,
                    progress: ProgressFn | None = None) -> ReportResponse:
        """Pełny raport. `satellite_budget_s` to czas, jaki raport czeka na zdjęcia satelitarne.
        `progress(etap, stan)`: zgłasza rzeczywisty postęp ('running' | 'done' | 'skipped') dla widoku liczenia."""
        started = time.perf_counter()
        mark = progress or _no_progress
        today = today or today_warsaw()
        window = analysis_window(request.date, today)
        bundle = await self._gatherer.gather(request, window, today, satellite_budget_s, mark)
        sources = [bundle.parcel_info, *weather_sources(bundle.weather), bundle.soil_info]
        soil_part = soil.soil_section(bundle.soil, bundle.soil_info, request.crop_with_timeline())
        series = bundle.weather.series
        if series is None or len(series.dates) < MIN_WEATHER_DAYS:
            return await self._without_weather(request, bundle, sources, soil_part, started)

        t0 = time.perf_counter()
        mark("balance", "running")
        balance = self._balance(request, bundle, today)
        bundle.timings["compute"] = round(time.perf_counter() - t0, 3)
        mark("balance", "done")
        return await self._finish(request, bundle, balance, sources, soil_part, window, today, started, mark)

    def _balance(self, request: ReportRequest, bundle: SourceBundle, today: date) -> _Balance:
        soil_assumed = bundle.soil is None
        crop_ = request.crop_with_timeline()
        variants = [assumed_variant()] if soil_assumed else build_variants(bundle.soil.layers, crop_.root_depth_m)
        c = compute(bundle.weather.series, crop_, variants)
        status = water_status_with_forecasts(c, bundle, soil_assumed, today)
        need = analysis.irrigation_need(c.dates, c.crop, c.crop_daily, irrigated_balance(c), c.series.rain_mm, HISTORY_YEARS)
        return _Balance(computed=c, status=status, history=history.history_section(c),
                        causes=causes.causes_section(c, status, soil_assumed),
                        irrigation=irrigation.irrigation_need_section(need))

    async def _finish(self, request: ReportRequest, bundle: SourceBundle, balance: _Balance, sources: list[SourceInfo],
                      soil_part: SoilSection, window: AnalysisWindow, today: date, started: float,
                      mark: ProgressFn) -> ReportResponse:
        c, status = balance.computed, balance.status
        parcel = bundle.parcel
        sat_result, sat_info = await self._gatherer.finish_satellite(bundle.satellite)
        if parcel is not None:
            mark("satellite", "done")
        mark("recommendations", "running")
        bundle.timings["satellite"] = sat_info.elapsed_s or 0.0
        prediction = (ml_bridge.predict_ndmi(sat_result.observations, c.series, request.date, (bundle.lat, bundle.lon))
                      if sat_result is not None else None)
        sat_section, sat_field_check = satellite.satellite_section(
            sat_result, sat_info, c, status.class_key or "none", request, parcel.id if parcel else None, prediction)
        satellite.sync_satellite_source(sat_info, sat_section)

        hydro = hydrology.hydrology_section(bundle.hydrology, bundle.hydrology_info, status.class_key, c.in_season)
        hydrology.add_watercourse(hydro, bundle.watercourse, bundle.watercourse_info, parcel is None)
        moisture = soil_moisture.soil_moisture_section(bundle.moisture, bundle.moisture_info, window.end, status.class_key)
        sources += [sat_info, bundle.hydrology_info, bundle.moisture_info, bundle.watercourse_info]
        causes.add_river_cause(balance.causes, hydro, status)
        recs = recommendations.recommendations_section(recommendations.recommendation_facts(
            c, status, balance.history, bundle.soil.layers if bundle.soil else None, soil_part, sat_section,
            sat_field_check, hydro))
        return ReportResponse(
            generated_at=datetime.now(UTC), elapsed_s=round(time.perf_counter() - started, 2),
            request=request, analysis_date=request.date, parcel=parcel_info(parcel) if parcel else None,
            crop=crop.crop_info(c, request), summary=summary.summary(status, c.in_season, recs),
            water_status=status, satellite=sat_section, history=balance.history, causes=balance.causes, soil=soil_part,
            soil_moisture=moisture, irrigation_need=balance.irrigation, terrain=summary.terrain_ref(parcel),
            hydrology=hydro, recommendations=recs,
            limitations=limitations.limitations(c.crop, c.dates[-1], window.end, request.date >= today,
                                                bundle.soil is None),
            sources=sources, timings_s=bundle.timings)

    async def _without_weather(self, request: ReportRequest, bundle: SourceBundle, sources: list[SourceInfo],
                               soil_part: SoilSection, started: float) -> ReportResponse:
        """Bez pogody nie ma bilansu: raport mówi to wprost i pokazuje tylko to, co od pogody nie zależy."""
        _result, sat_info = await self._gatherer.finish_satellite(bundle.satellite)
        sources += [sat_info, bundle.hydrology_info, bundle.watercourse_info, bundle.moisture_info]
        hydro = hydrology.hydrology_section(bundle.hydrology, bundle.hydrology_info, None, False)
        hydrology.add_watercourse(hydro, bundle.watercourse, bundle.watercourse_info, bundle.parcel is None)
        crop_ = request.crop_with_timeline()
        return ReportResponse(
            generated_at=datetime.now(UTC), elapsed_s=round(time.perf_counter() - started, 2),
            request=request, analysis_date=request.date,
            parcel=parcel_info(bundle.parcel) if bundle.parcel else None, soil=soil_part, hydrology=hydro,
            sources=sources, timings_s=bundle.timings, **summary.no_weather_sections(request.crop, crop_.name))


def water_status_with_forecasts(c: Computed, bundle: SourceBundle, soil_assumed: bool, today: date) -> WaterStatus:
    """Sytuacja wodna razem z prognozą zapasu: bilans na prognozie pogody i model wilgotności ML."""
    status = water_status(c, soil_assumed)
    status.forecast_reason = bundle.forecast_reason
    forecast.project_forecast(status, c, bundle.forecast)
    if bundle.ifs is None:
        status.ml_forecast = forecast.ml_not_available(bundle.ifs_reason)
    elif c.main.taw_mm <= 0:
        status.ml_forecast = forecast.ml_not_available(forecast.ZERO_TAW_REASON)
    else:
        status.ml_forecast = forecast.ml_forecast(
            c, ml_bridge.predict_moisture(c.series, bundle.ifs, bundle.soil.layers if bundle.soil else None, today), today)
    return status

