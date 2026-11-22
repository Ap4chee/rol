"""Prognoza ECMWF IFS 0,25° z Open-Meteo Forecast (`models=ecmwf_ifs025`) dla modelu wilgotności gleby v3 (kowr_ml).

Te same wielkości co w treningu z archiwum ECMWF open data (kowr_ml/ifs.py), w dobach UTC dnia t … t+13:
  opad doby = suma godzin (00 UTC, 24 h] (godzinowa wartość Open-Meteo dotyczy godziny przed znacznikiem),
  temperatura 2 m i wilgotność 0–100 cm o 12 UTC (wilgotność: warstwy 0–7, 7–28, 28–100 cm ważone grubością),
  wilgotność z analizy: 00 UTC dnia t.
Sprawdzone 22.11.2026 dla 52,25 N 19,35 E: komórka 52,25 / 19,25, 216 godzin bez braków (past_days=1, forecast_days=8),
oraz dla 51,09 N 22,36 E: 351 z 384 godzin wilgotności i 14 z 16 dób opadu (forecast_days=16), stąd 14 dni.
To API działa z sieci hackathonu, w przeciwieństwie do archiwum Open-Meteo (429).
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta

import httpx
import numpy as np

from app.config import TIMEOUT_WEATHER_RECENT_S
from app.infra import cache
from app.sources import NoData
from app.sources.weather import OPEN_METEO_FORECAST_URL, RECENT_CACHE_MAX_AGE_S, _get_json, snap

HOURLY = "precipitation,temperature_2m,soil_moisture_0_to_7cm,soil_moisture_7_to_28cm,soil_moisture_28_to_100cm"
LAYERS = (("soil_moisture_0_to_7cm", 7), ("soil_moisture_7_to_28cm", 21), ("soil_moisture_28_to_100cm", 72))
DAYS = 14   # tyle pełnych dób IFS daje Open-Meteo; model wilgotności v3 jest uczony na tym samym horyzoncie
SOURCE_NAME = "Open-Meteo Forecast, model ECMWF IFS 0,25° (opad, temperatura, wilgotność gleby)"


@dataclass
class IfsForecast:
    issue_date: date            # dzień t
    rain_mm: list[float]        # doby UTC t … t+13, NaN przy braku
    t2m_c: list[float]          # 12 UTC
    sm_0_100cm: list[float]     # 12 UTC [m3/m3]
    sm_analysis: float          # 00 UTC dnia t [m3/m3]
    cell_lat: float | None = None
    cell_lon: float | None = None


def parse(payload: dict, t: date, days: int = DAYS) -> IfsForecast:
    hourly = payload.get("hourly") if isinstance(payload, dict) else None
    if not isinstance(hourly, dict) or not isinstance(hourly.get("time"), list):
        raise NoData("Open-Meteo nie zwróciło godzinowej prognozy IFS.")
    at = {datetime.fromisoformat(s): i for i, s in enumerate(hourly["time"])}

    def value(name: str, when: datetime) -> float:
        i = at.get(when)
        v = hourly.get(name, [])[i] if i is not None and i < len(hourly.get(name, [])) else None
        return float(v) if v is not None else np.nan

    def sm(when: datetime) -> float:
        return sum(value(name, when) * cm for name, cm in LAYERS) / 100.0

    start = datetime(t.year, t.month, t.day)
    rain, t2m, soil = [], [], []
    for k in range(days):
        day = start + timedelta(days=k)
        rain.append(sum(value("precipitation", day + timedelta(hours=h)) for h in range(1, 25)))
        t2m.append(value("temperature_2m", day + timedelta(hours=12)))
        soil.append(sm(day + timedelta(hours=12)))
    if not np.isfinite(rain).any():
        raise NoData(f"Prognoza IFS nie obejmuje dni od {t.isoformat()}.")
    return IfsForecast(t, rain, t2m, soil, sm(start), payload.get("latitude"), payload.get("longitude"))


async def fetch(client: httpx.AsyncClient, lat: float, lon: float, today: date) -> tuple[IfsForecast, bool]:
    lat, lon = snap(lat), snap(lon)
    key = f"om_ifs_sm_{DAYS}d:{lat:.2f},{lon:.2f}:{today}"   # liczba dni w kluczu: zmiana horyzontu nie bierze starej odpowiedzi
    cached = cache.get("weather", key, max_age_s=RECENT_CACHE_MAX_AGE_S)
    if cached is not None:
        return parse(cached, today), True
    payload = await _get_json(client, OPEN_METEO_FORECAST_URL, {
        "latitude": lat, "longitude": lon, "models": "ecmwf_ifs025", "hourly": HOURLY,
        "past_days": 1, "forecast_days": DAYS + 1, "timezone": "GMT",
    }, TIMEOUT_WEATHER_RECENT_S, "Open-Meteo Forecast (ECMWF IFS)")
    forecast = parse(payload, today)
    cache.put("weather", key, {"hourly": payload["hourly"], "latitude": payload.get("latitude"),
                               "longitude": payload.get("longitude")})
    return forecast, False
