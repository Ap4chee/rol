"""Jedyne miejsce, które importuje kowr_ml. Zamienia słowniki z modeli na typowane wyniki.

Model jest dodatkiem do bilansu: brak biblioteki, pliku modelu albo błąd w nim daje wynik z powodem,
a raport liczy się dalej. Wyjątek trafia do logu, żeby prawdziwy błąd nie zginął po cichu.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import date

from app.core.soil import Layer
from app.sources.ifs_forecast import IfsForecast
from app.sources.sentinel import Observation
from app.sources.weather import DailyWeather

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class NdmiPrediction:
    """Prognoza zmiany NDMI na 7–14 dni po dniu analizy (mediana i przedział 80%)."""
    available: bool
    reason: str | None = None
    status: str | None = None
    model_run: str | None = None
    window_from: date | None = None
    window_to: date | None = None
    ndmi_last: float | None = None
    last_scene_date: date | None = None
    last_scene_age_days: int | None = None
    delta_p50: float | None = None
    delta_p10: float | None = None
    delta_p90: float | None = None
    inputs: dict[str, float | None] = field(default_factory=dict)


@dataclass(frozen=True)
class MoisturePoint:
    date: date
    delta_p10: float   # zmiana wilgotności 0–100 cm od doby t−1 [m3/m3]
    delta_p50: float
    delta_p90: float


@dataclass(frozen=True)
class MoisturePrediction:
    available: bool
    reason: str | None = None
    status: str | None = None
    model_run: str | None = None
    interval_coverage_test: float | None = None   # pokrycie przedziału 80% na zbiorze testowym z karty modelu
    points: list[MoisturePoint] = field(default_factory=list)


def _unavailable(exc: Exception) -> str:
    return f"moduł prognozy niedostępny ({type(exc).__name__})"


def _as_date(value) -> date | None:
    if value is None or isinstance(value, date):
        return value
    return date.fromisoformat(str(value)[:10])


def predict_ndmi(observations: list[Observation], weather: DailyWeather, day: date,
                 location: tuple[float, float] | None) -> NdmiPrediction | None:
    """Prognoza NDMI albo None poza sezonem modelu. location to (lat, lon) w EPSG:4326."""
    try:
        from kowr_ml import NdmiForecaster
        if not NdmiForecaster.in_season(day):
            return None
        lat, lon = location if location else (None, None)
        out = NdmiForecaster.default().predict(observations, weather, day, lat=lat, lon=lon)
    except Exception as exc:   # brak scikit-learn, uszkodzony plik modelu itp.
        log.warning("Prognoza NDMI się nie policzyła", exc_info=exc)
        return NdmiPrediction(available=False, reason=_unavailable(exc))
    known = {k: v for k, v in out.items() if k in NdmiPrediction.__dataclass_fields__}
    return NdmiPrediction(**{
        **known,
        "window_from": _as_date(out.get("window_from")), "window_to": _as_date(out.get("window_to")),
        "last_scene_date": _as_date(out.get("last_scene_date"))})


def predict_moisture(weather: DailyWeather, ifs: IfsForecast, soil_layers: list[Layer] | None,
                     today: date) -> MoisturePrediction:
    """Zmiana wilgotności gleby 0–100 cm na 14 dni (model v3 na prognozie ECMWF IFS)."""
    try:
        from kowr_ml import SoilMoistureForecaster
        out = SoilMoistureForecaster.default().predict(weather, ifs, soil_layers, today)
    except Exception as exc:   # brak scikit-learn, uszkodzony plik modelu itp.
        log.warning("Prognoza wilgotności się nie policzyła", exc_info=exc)
        return MoisturePrediction(available=False, reason=_unavailable(exc))
    if not out["available"]:
        return MoisturePrediction(available=False, reason=out["reason"])
    return MoisturePrediction(
        available=True, status=out["status"], model_run=out["model_run"],
        interval_coverage_test=out.get("interval_coverage_test"),
        points=[MoisturePoint(date=p["date"], delta_p10=p["delta_p10"], delta_p50=p["delta_p50"],
                              delta_p90=p["delta_p90"]) for p in out["points"]])
