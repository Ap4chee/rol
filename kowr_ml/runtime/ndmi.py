"""Prognoza zmiany NDMI działki na okno t+7 … t+14 z danych, które aplikacja i tak pobiera (bez dodatkowych zapytań).

Wejście: obserwacje Sentinel-2 z app/sources/sentinel.py (Observation: data, liczby pikseli klas SCL wszystkich scen
z 45 dni, NDMI/NDVI i mediany pasm dla najwyżej trzech czystych scen) i seria pogody z app/sources/weather.py
(DailyWeather). Dzień prognozy t = data analizy: obserwacje i pogoda tylko do t-1.
Bez danych wejściowych zwracamy powód zamiast prognozy (AGENTS.md, „Model ML”). Trening jest w kowr_ml/pipeline/ndmi.
"""
from __future__ import annotations

from datetime import date, timedelta
from functools import cache
from pathlib import Path

import numpy as np

from kowr_ml.runtime import config as C
from kowr_ml.runtime.features import NAN, FieldScenes, WeatherSeries, feature_row
from kowr_ml.runtime.registry import ModelBundle, is_installed, model_dir

NOT_INSTALLED = "model prognozy nie jest zainstalowany"


def in_season(t: date) -> bool:
    """Czy t leży w okresie dni prognozy, na którym model był uczony (01.04–15.10)."""
    first = date.fromisoformat(f"{t.year}-{C.ISSUE_FIRST}")
    last = date.fromisoformat(f"{t.year}-{C.ISSUE_LAST}")
    return first <= t <= last


def scenes_from_observations(observations: list) -> FieldScenes:
    """Obserwacje aplikacji jako sceny pola. Wskaźniki bierzemy tylko ze scen zaakceptowanych i policzonych."""
    rows = [o for o in observations if o.total_pixels]

    def value(o, name: str) -> float:
        v = getattr(o, name, None)
        return NAN if v is None or not (o.accepted and o.ndmi is not None) else float(v)

    return FieldScenes.from_columns(
        dates=[o.date for o in rows], total_px=[o.total_pixels for o in rows], veg_px=[o.valid_pixels for o in rows],
        bare_px=[o.bare_pixels for o in rows], cloud_px=[o.cloudy_pixels for o in rows],
        valid_fraction=[o.valid_pixels / o.total_pixels for o in rows],
        ndmi=[value(o, "ndmi") for o in rows], ndvi=[value(o, "ndvi") for o in rows], nir=[value(o, "nir08") for o in rows],
        swir=[value(o, "swir16") for o in rows], red=[value(o, "red") for o in rows])


def _out_of_season_reason() -> str:
    return (f"poza okresem, na którym model był uczony ({C.ISSUE_FIRST[3:]}.{C.ISSUE_FIRST[:2]}–"
            f"{C.ISSUE_LAST[3:]}.{C.ISSUE_LAST[:2]}); poza sezonem wegetacji zmiana NDMI nie mówi o stanie upraw")


def _rounded_or_none(value: float) -> float | None:
    return None if not np.isfinite(value) else round(float(value), 3)


class NdmiForecaster:
    """Model zmiany NDMI z jednego katalogu przebiegu. Plik modelu wczytuje się raz, przy pierwszej prognozie."""

    def __init__(self, directory: Path):
        self.directory = Path(directory)
        self._bundle: ModelBundle | None = None

    @classmethod
    @cache
    def default(cls) -> NdmiForecaster:
        """Model przypięty w kowr_ml/models/CURRENT.json (albo wskazany przez KOWR_ML_MODEL_DIR), jeden na proces."""
        return cls(model_dir("ndmi"))

    in_season = staticmethod(in_season)

    @property
    def bundle(self) -> ModelBundle:
        if self._bundle is None:
            self._bundle = ModelBundle.load(self.directory)
        return self._bundle

    def predict(self, observations: list, weather, t: date, lat: float | None = None, lon: float | None = None) -> dict:
        """Wynik do raportu: {'available': True, ...} albo {'available': False, 'reason': ...}.

        lat, lon – środek działki w EPSG:4326 (cechy modelu); bez nich model dostaje brak wartości.
        """
        if not is_installed(self.directory):
            return {"available": False, "reason": NOT_INSTALLED}
        if not in_season(t):
            return {"available": False, "reason": _out_of_season_reason()}
        scenes = scenes_from_observations(observations)
        if scenes.accepted.size == 0:
            return {"available": False, "reason": "brak czystego zdjęcia satelitarnego działki z wartością NDMI"}
        if weather is None:
            return {"available": False, "reason": "brak serii pogodowej"}
        series = WeatherSeries(list(weather.dates), weather.rain_mm, weather.et0_mm, weather.tmax_c,
                               getattr(weather, "tmin_c", None))
        row = feature_row(scenes, series, t, NAN if lat is None else lat, NAN if lon is None else lon)
        if row is None:
            last = date.fromisoformat(str(scenes.dates[scenes.accepted[-1]]))
            return {"available": False, "reason": (
                f"ostatnie czyste zdjęcie pola jest z {last:%d.%m.%Y}, a model potrzebuje zdjęcia "
                f"z {C.LAST_WINDOW_DAYS[1]} dni przed datą analizy i pełnej pogody z ostatnich 30 dni")}
        return self._forecast(row, scenes, t)

    def _forecast(self, row: dict, scenes: FieldScenes, t: date) -> dict:
        models, card = self.bundle.estimators, self.bundle.card
        # Tablica numpy w kolejności cech z modelu: aplikacja nie potrzebuje pandas.
        X = np.array([[row.get(k, np.nan) for k in models["features"]]], dtype=float)
        p50 = float(models["median"].predict(X)[0])
        lo, hi = float(models["p10"].predict(X)[0]), float(models["p90"].predict(X)[0])
        # Kalibracja przedziału z treningu (pipeline/ndmi/train.py, interval_adjustments);
        # starsze pliki modelu mają jedną wspólną poprawkę.
        adj_low = float(models.get("interval_adjust_low", models.get("interval_adjust", 0.0)))
        adj_high = float(models.get("interval_adjust_high", models.get("interval_adjust", 0.0)))
        p10, p90 = min(lo, hi, p50) - adj_low, max(lo, hi, p50) + adj_high
        k = row["_last_index"]
        return {
            "available": True,
            "status": card.get("status"),
            "model_run": card.get("run_id"),
            "window_from": (t + timedelta(days=C.TARGET_WINDOW_DAYS[0])).isoformat(),
            "window_to": (t + timedelta(days=C.TARGET_WINDOW_DAYS[1])).isoformat(),
            "ndmi_last": round(row["ndmi_last"], 3),
            "last_scene_date": str(scenes.dates[k]),
            "last_scene_age_days": int(row["days_since_last_scene"]),
            "delta_p50": round(p50, 3), "delta_p10": round(p10, 3), "delta_p90": round(p90, 3),
            "inputs": {key: _rounded_or_none(row.get(key, np.nan)) for key in models["features"]},
        }
