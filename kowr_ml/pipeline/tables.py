"""Odczyt tabel pogody (Parquet) do serii z kowr_ml/runtime/features.py, wspólny dla obu modeli i eksperymentów."""
from __future__ import annotations

from datetime import date

import pandas as pd

from kowr_ml.pipeline import config as C
from kowr_ml.runtime.features import WeatherSeries


def weather_series(g: pd.DataFrame) -> WeatherSeries:
    g = g.sort_values("date")
    return WeatherSeries([date.fromisoformat(d) for d in g["date"]], g["rain_mm"], g["et0_mm"], g["tmax_c"], g.get("tmin_c"))


def weather_by_cluster(name: str = "weather.parquet") -> dict[str, WeatherSeries]:
    w = pd.read_parquet(C.DATA_DIR / name)
    return {cluster: weather_series(g) for cluster, g in w.groupby("cluster")}
