"""Pogoda dzienna z archiwum Open-Meteo, jedna komórka na skupisko (środek skupiska, zaokrąglony jak w aplikacji).

Jedna komórka na skupisko, bo zapytanie o 7 lat liczy się w limicie Open-Meteo jak wiele wywołań,
a skupisko 6 × 6 km mieści się w jednej–dwóch komórkach siatki ERA5-Land (ok. 9 km).
Te same parametry co app/sources/weather.py: zmienne dzienne, timezone=Europe/Warsaw, domyślny model.
Surowe odpowiedzi zapisujemy w data/weather_raw/, żeby nie odpytywać drugi raz.
Wynik: weather.parquet z kolumnami cluster, date, rain_mm, et0_mm, tmax_c, tmin_c, cell_lat, cell_lon.
"""
from __future__ import annotations

import json
import time

import httpx
import pandas as pd

from . import config as C


def fetch_cell(lat: float, lon: float) -> dict:
    params = {"latitude": round(lat, 2), "longitude": round(lon, 2), "start_date": C.WEATHER_START,
              "end_date": C.WEATHER_END, "daily": C.OPEN_METEO_DAILY, "timezone": "Europe/Warsaw"}
    for attempt in range(4):
        r = httpx.get(C.OPEN_METEO_ARCHIVE_URL, params=params, timeout=120)
        if r.status_code == 200:
            return r.json()
        print(f"Open-Meteo {r.status_code}: {r.text[:200]}", flush=True)
        time.sleep(10 * (attempt + 1))
    r.raise_for_status()
    raise RuntimeError("Open-Meteo nie odpowiada")


def main() -> None:
    raw_dir = C.DATA_DIR / "weather_raw"
    raw_dir.mkdir(parents=True, exist_ok=True)
    frames = []
    for name, lat, lon in C.CLUSTERS:
        path = raw_dir / f"{name}.json"
        if not path.exists():
            path.write_text(json.dumps(fetch_cell(lat, lon)))
            time.sleep(2)  # z umiarem: kilkanaście zapytań, każde liczy się jak wiele wywołań
        p = json.loads(path.read_text())
        d = p["daily"]
        frames.append(pd.DataFrame({
            "cluster": name, "date": d["time"], "rain_mm": d["precipitation_sum"],
            "et0_mm": d["et0_fao_evapotranspiration"], "tmax_c": d["temperature_2m_max"],
            "tmin_c": d["temperature_2m_min"], "cell_lat": p.get("latitude"), "cell_lon": p.get("longitude")}))
        print(f"{name}: komórka {p.get('latitude')}, {p.get('longitude')}, dni {len(d['time'])}", flush=True)
    df = pd.concat(frames, ignore_index=True)
    df.to_parquet(C.DATA_DIR / "weather.parquet", index=False)
    print(f"zapisano {len(df)} wierszy pogody")


if __name__ == "__main__":
    main()
