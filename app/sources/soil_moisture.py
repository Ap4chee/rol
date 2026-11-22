"""Wilgotność gleby w trzech warstwach z NASA POWER (model MERRA-2), dzienne serie dla okolicy działki.

Parametry (community=AG, bez klucza API): GWETTOP (powierzchnia 0–5 cm), GWETROOT (strefa korzeni
0–100 cm), GWETPROF (cały profil). Wartości 0–1: wilgotność względna, 0 = sucho, 1 = nasycenie.
Sprawdzone 21.11.2026 dla 51,093°N 22,356°E: odpowiedź z wartościami ok. 0,34–0,41 (lipiec 2025).
Open-Meteo ma podobne dane z ERA5-Land, ale z sieci hackathonu zwraca 429, więc korzystamy z NASA POWER.
"""
from __future__ import annotations

from datetime import date

import httpx

from app.config import TIMEOUT_WEATHER_POWER_S, check_forced_failure
from app.core.soil_moisture import LAYERS
from app.infra import cache
from app.sources import NoData, SourceError
from app.sources.weather import NASA_POWER_URL, _get_json, snap

PARAMETERS = ",".join(param for _, param, *_ in LAYERS)
SOURCE_NAME = "NASA POWER: wilgotność gleby w warstwach (model MERRA-2)"
RESOLUTION = "siatka 0,5° × 0,625° (ok. 55 × 45 km): wartość dla okolicy, nie dla działki"
LICENSE = "dane NASA udostępniane bezpłatnie i bez ograniczeń (szczegóły w README)"
URL = "https://power.larc.nasa.gov/docs/"


def parse(payload: dict) -> dict[str, dict[date, float]]:
    """{parametr: {dzień: wartość 0–1}} bez dni z wartością `fill_value`."""
    try:
        params = payload["properties"]["parameter"]
    except (KeyError, TypeError) as exc:
        raise SourceError("NASA POWER: nieoczekiwany układ odpowiedzi") from exc
    fill = float((payload.get("header") or {}).get("fill_value", -999.0))
    out: dict[str, dict[date, float]] = {}
    for name, values in params.items():
        out[name] = {date(int(k[:4]), int(k[4:6]), int(k[6:8])): float(v)
                     for k, v in values.items() if v is not None and float(v) != fill}
    if not any(out.values()):
        raise NoData("NASA POWER nie zwróciło wilgotności gleby dla tego miejsca")
    return out


async def fetch(client: httpx.AsyncClient, lat: float, lon: float, start: date, end: date
                ) -> tuple[dict[str, dict[date, float]], bool]:
    """Serie dzienne dla komórki siatki. Zwraca (serie, czy_z_cache)."""
    lat, lon = snap(lat), snap(lon)
    key = f"nasa_power_gwet:{lat:.2f},{lon:.2f}:{start}:{end}"
    cached = cache.get("soil_moisture", key)
    if cached:
        return parse(cached), True
    check_forced_failure("soil_moisture")
    payload = await _get_json(client, NASA_POWER_URL, {
        "parameters": PARAMETERS, "community": "AG", "longitude": lon, "latitude": lat,
        "start": start.strftime("%Y%m%d"), "end": end.strftime("%Y%m%d"), "format": "JSON",
    }, TIMEOUT_WEATHER_POWER_S, "NASA POWER")
    series = parse(payload)
    cache.put("soil_moisture", key, {"properties": {"parameter": payload["properties"]["parameter"]},
                                     "header": payload.get("header")})
    return series, False
