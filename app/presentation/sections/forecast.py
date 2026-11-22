"""Prognoza zapasu wody na najbliższe dni: bilans FAO-56 na prognozie pogody i model wilgotności ML.

Obie linie dotyczą tylko analizy na dziś. Prognoza pogody do pulpitu jest mapowana na schemat API też tutaj.
"""
from __future__ import annotations

from dataclasses import asdict
from datetime import date, timedelta

import numpy as np

from app.config import HISTORY_YEARS
from app.core import analysis
from app.core.balance_run import Computed, project_balance
from app.core.textfmt import fmt, fmt_date, plural_days
from app.schemas import ForecastDay, ForecastPoint, ForecastResponse, MlForecast, MlForecastPoint, Status, WaterStatus
from app.services.ml_bridge import MoisturePrediction
from app.sources import ifs_forecast
from app.sources.weather import DashboardForecast

# Model wilgotności przewiduje warstwę 0–100 cm, więc dla głębszych korzeni zmianę odnosimy do 1 m.
ML_LABEL_DEPTH_M = 1.0
# Przedział 80% pokrywający mniej niż 78% obserwacji testowych opisujemy jako za wąski, poniżej 72% wyraźnie.
COVERAGE_OK = 0.78
COVERAGE_SLIGHTLY_LOW = 0.72


def forecast_response(forecast: DashboardForecast) -> ForecastResponse:
    return ForecastResponse(
        status=Status.ok, days=[ForecastDay(**asdict(d)) for d in forecast.days],
        recent=[ForecastDay(**asdict(d)) for d in forecast.recent], last_wet_day=forecast.last_wet_day,
        past_days_complete=forecast.past_days_complete)


def project_forecast(status: WaterStatus, c: Computed, forecast: DashboardForecast | None) -> None:
    """Dopisuje do sekcji sytuacji wodnej bilans puszczony dalej po prognozie pogody."""
    if forecast is None:
        return
    last = c.dates[-1]
    days = [d for d in forecast.days if d.date > last and d.precipitation_mm is not None and d.et0_mm is not None]
    if not days or days[0].date != last + timedelta(days=1):
        status.forecast_reason = (f"Prognoza zaczyna się później niż ostatni dzień bilansu ({fmt_date(last)}), "
                                  "więc nie da się jej dołączyć bez luki.")
        return
    # tyle dni, ile prognozy modelu AI (ifs_forecast.DAYS), żeby obie linie na wykresie kończyły się razem
    days = [d for i, d in enumerate(days) if d.date == days[0].date + timedelta(days=i)][:ifs_forecast.DAYS]
    crop_daily, result = project_balance(c, [d.date for d in days], np.array([d.precipitation_mm for d in days]),
                                         np.array([d.et0_mm for d in days]))
    taw = c.main.taw_mm
    # „typowo” na dni prognozy: te same dni w 10 poprzednich latach bilansu, jak dla przebiegu dziennego
    band = analysis.typical_for(c.dates, 100.0 * (1.0 - c.main.depletion_mm / taw), [d.date for d in days], HISTORY_YEARS)
    for i, d in enumerate(days):
        available = 100.0 * (1.0 - result.depletion_mm[i] / taw)
        threshold = 100.0 * (1.0 - result.raw_mm[i] / taw)
        p10, p50, p90 = (round(v, 1) for v in band[i]) if band[i] else (None, None, None)
        status.forecast.append(ForecastPoint(date=d.date, rain_mm=round(d.precipitation_mm, 1), et0_mm=round(d.et0_mm, 2),
                                             available_pct=round(available, 1), stress_threshold_pct=round(threshold, 1),
                                             typical_p10_pct=p10, typical_median_pct=p50, typical_p90_pct=p90))
        if status.forecast_stress_day is None and crop_daily.in_field[i] and available < threshold:
            status.forecast_stress_day = d.date


def ml_forecast(c: Computed, prediction: MoisturePrediction, today: date) -> MlForecast:
    """Zapas działki na dni t … t+13 z modelu wilgotności.

    Model daje zmianę wilgotności 0–100 cm od ostatniej doby bilansu (t−1). Zmianę przeliczamy na mm wody w strefie
    korzeni (do 1 m, bo tyle obejmuje etykieta) i doczepiamy do zapasu działki z bilansu FAO-56 z tej doby.
    """
    if not prediction.available:
        return MlForecast(available=False, reason=prediction.reason)
    taw = c.main.taw_mm
    start = 100.0 * (1.0 - float(c.main.depletion_mm[-1]) / taw)
    scale = 100.0 * 1000.0 * min(c.crop.root_depth_m, ML_LABEL_DEPTH_M) / taw   # Δθ [m3/m3] -> % TAW działki

    def pct(delta: float) -> float:
        return round(min(max(start + scale * delta, 0.0), 100.0), 1)

    points = [MlForecastPoint(date=p.date, available_pct=pct(p.delta_p50), low_pct=pct(p.delta_p10),
                              high_pct=pct(p.delta_p90)) for p in prediction.points]
    text = [f"Prognoza modelu uczenia maszynowego ({prediction.status}) na {plural_days(len(points))}: zmiana wilgotności gleby "
            f"0–100 cm z modelu uczonego na reanalizie ERA5-Land i prognozie ECMWF IFS, doczepiona do zapasu działki "
            f"z {fmt_date(c.dates[-1])}. Pas wokół linii to przedział 80%."]
    coverage = prediction.interval_coverage_test
    if coverage is not None and coverage < COVERAGE_OK:
        text.append(f"W teście na sezonie 2025 ten przedział obejmował {fmt(100 * coverage)}% obserwacji, "
                    + ("czyli jest nieco za wąski." if coverage >= COVERAGE_SLIGHTLY_LOW
                       else "czyli jest za wąski: rzeczywista zmiana częściej wypada poza pas, zwłaszcza w dalszych dniach."))
    recent = [o for d, o in zip(c.series.dates, c.series.origin) if today - timedelta(days=30) <= d < today]
    if any(o == "nasa_power" for o in recent):
        text.append("Pogoda z ostatnich 30 dni pochodzi z NASA POWER, a model uczono na reanalizie ERA5, "
                    "więc prognoza jest mniej pewna niż zwykle.")
    return MlForecast(available=True, model_run=prediction.model_run, model_status=prediction.status, points=points,
                      text=text)


ZERO_TAW_REASON = "zerowa pojemność wodna strefy korzeni"


def ml_not_available(reason: str | None) -> MlForecast | None:
    """Ramka „brak prognozy” z powodem; bez powodu (data historyczna) raport nie pokazuje ramki wcale."""
    return MlForecast(available=False, reason=reason) if reason else None
