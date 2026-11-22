"""Pogoda dzienna z archiwum Open-Meteo, jedna komórka na skupisko (środek skupiska, zaokrąglony jak w aplikacji).

Jedna komórka na skupisko, bo skupisko 6 × 6 km mieści się w jednej–dwóch komórkach siatki ERA5-Land (ok. 9 km).
Te same parametry co app/sources/weather.py: zmienne dzienne, timezone=Europe/Warsaw, domyślny model.
Surowe odpowiedzi zapisujemy w data/weather_raw/, żeby nie odpytywać drugi raz.

Limit: zapytanie o 10 lat danych dziennych liczy się w Open-Meteo jak ok. 260 wywołań, a darmowy limit to
10 000 na dobę na adres IP, czyli ok. 38 skupisk dziennie. Skrypt pobiera powoli, po odpowiedzi „limit dobowy”
kończy pracę, a ponowne uruchomienie dociąga brakujące skupiska. Tabela treningowa powstaje z tego, co jest:
dla skupiska bez pogody z danego okresu nie ma wierszy z tego okresu.

Wynik: weather.parquet z kolumnami cluster, date, rain_mm, et0_mm, tmax_c, tmin_c, cell_lat, cell_lon.
"""
from __future__ import annotations

import json
import time

import httpx
import pandas as pd

from . import config as C

PAUSE_S = 40.0   # odstęp między zapytaniami (limit minutowy liczy długie zakresy jak wiele wywołań)


def fetch_cell(lat: float, lon: float) -> dict | None:
    """Odpowiedź Open-Meteo albo None po wyczerpaniu limitu dobowego."""
    params = {"latitude": round(lat, 2), "longitude": round(lon, 2), "start_date": C.WEATHER_START,
              "end_date": C.WEATHER_END, "daily": C.OPEN_METEO_DAILY, "timezone": "Europe/Warsaw"}
    for _attempt in range(12):
        try:
            r = httpx.get(C.OPEN_METEO_ARCHIVE_URL, params=params, timeout=180)
        except httpx.HTTPError as e:
            print(f"Open-Meteo: {e!r}", flush=True)
            time.sleep(30)
            continue
        if r.status_code == 200:
            return r.json()
        text = r.text[:200]
        if "aily" in text:
            print(f"Open-Meteo: limit dobowy ({text})", flush=True)
            return None
        wait = 1200 if "ourly" in text else 70
        print(f"Open-Meteo {r.status_code}: {text}; czekam {wait} s", flush=True)
        time.sleep(wait)
    return None


def build_table() -> int:
    frames = []
    for path in sorted((C.DATA_DIR / "weather_raw").glob("*.json")):
        p = json.loads(path.read_text())
        d = p["daily"]
        frames.append(pd.DataFrame({
            "cluster": path.stem, "date": d["time"], "rain_mm": d["precipitation_sum"],
            "et0_mm": d["et0_fao_evapotranspiration"], "tmax_c": d["temperature_2m_max"],
            "tmin_c": d["temperature_2m_min"], "cell_lat": p.get("latitude"), "cell_lon": p.get("longitude")}))
    if frames:
        pd.concat(frames, ignore_index=True).to_parquet(C.DATA_DIR / "weather.parquet", index=False)
    return len(frames)


def main() -> None:
    raw_dir = C.DATA_DIR / "weather_raw"
    raw_dir.mkdir(parents=True, exist_ok=True)
    for name, lat, lon in C.CLUSTERS:
        path = raw_dir / f"{name}.json"
        if path.exists():
            continue
        payload = fetch_cell(lat, lon)
        if payload is None:
            print(f"przerwano na {name}; uruchom ponownie po odnowieniu limitu", flush=True)
            break
        path.write_text(json.dumps(payload))
        print(f"{name}: komórka {payload.get('latitude')}, {payload.get('longitude')}, dni {len(payload['daily']['time'])}", flush=True)
        time.sleep(PAUSE_S)
    print(f"weather.parquet: {build_table()} z {len(C.CLUSTERS)} skupisk")


if __name__ == "__main__":
    main()
