"""Porównanie dostawców pogody na wspólnych dniach (weryfikacja własnego ET0 z NASA POWER).

Open-Meteo Forecast z `past_days=92` podaje gotowe ET0 FAO-56; NASA POWER daje składowe,
z których ET0 liczy app/core/et0.py. Skrypt wypisuje sumy opadu i ET0 z obu źródeł dla wspólnych dni.

  python scripts/checks/check_weather_providers.py 22.3559 51.0933
"""
from __future__ import annotations

import asyncio
import sys
from datetime import timedelta
from pathlib import Path

import httpx
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from app.report import today_warsaw  # noqa: E402
from app.sources import weather  # noqa: E402


async def main(lon: float, lat: float) -> None:
    today = today_warsaw()
    start, end = today - timedelta(days=95), today - timedelta(days=1)
    async with httpx.AsyncClient() as client:
        power, _ = await weather.fetch_nasa_power(client, lat, lon, start, end)
        recent, _ = await weather.fetch_open_meteo_recent(client, lat, lon, 92, today)
    a, b = weather.align(power, start, end), weather.align(recent, start, end)
    both = a.complete() & b.complete()
    n = int(both.sum())
    print(f"punkt lon={lon} lat={lat}; wspólne kompletne dni: {n} ({a.dates[int(np.argmax(both))]} – "
          f"{a.dates[len(both) - 1 - int(np.argmax(both[::-1]))]})")
    for name, x, y in (("opad", a.rain_mm, b.rain_mm), ("ET0", a.et0_mm, b.et0_mm)):
        sx, sy = float(x[both].sum()), float(y[both].sum())
        corr = float(np.corrcoef(x[both], y[both])[0, 1])
        print(f"  {name:5s} NASA POWER {sx:7.1f} mm | Open-Meteo {sy:7.1f} mm | stosunek {sx / sy:5.2f} | "
              f"korelacja dzienna {corr:4.2f}")
    print(f"  Tmax średnia: NASA {np.nanmean(a.tmax_c[both]):.1f} °C | Open-Meteo {np.nanmean(b.tmax_c[both]):.1f} °C")


if __name__ == "__main__":
    asyncio.run(main(float(sys.argv[1]), float(sys.argv[2])))
