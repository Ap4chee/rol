"""Prognoza modelu wilgotności gleby v3 dla działki i dnia t: zmiana θ 0–100 cm od t−1 na dni t … t+13.

Wejścia, które aplikacja i tak ma, plus prognoza IFS (app/sources/ifs_forecast.py): pogoda dzienna do t−1
(DailyWeather: dates, rain_mm, et0_mm, tmax_c), warstwy gleby z SoilGrids (albo None), prognoza IFS wydana w dniu t.
Cechy liczone tak jak w treningu (kowr_ml/pipeline/soil_moisture), ale bez pandas: aplikacja go nie potrzebuje.
Bez danych wejściowych zwracamy powód zamiast prognozy (AGENTS.md, „Model ML”).
"""
from __future__ import annotations

import math
from datetime import date, timedelta
from functools import cache
from pathlib import Path

import numpy as np

from kowr_ml.runtime.features import WeatherSeries, doy_features
from kowr_ml.runtime.registry import ModelBundle, is_installed, model_dir

NOT_INSTALLED = "model prognozy wilgotności nie jest zainstalowany"
ROOT_DEPTH_M = 1.0          # FC i WP średnie 0–100 cm, jak etykieta
TOPSOIL_DEPTH_CM = 30.0     # uziarnienie i węgiel z warstwy ornej
FORECAST_WEEK_DAYS = 7      # fc_rain_mm_7d: suma dni t … t+6 niezależnie od horyzontu
SOIL_FEATURES = ("soil_sand_pct", "soil_clay_pct", "soil_soc_g_kg", "soil_fc_m3m3", "soil_wp_m3m3")


def topsoil(layers, attr: str, depth_cm: float = TOPSOIL_DEPTH_CM) -> float | None:
    """Średnia ważona miąższością warstw w 0–depth_cm; None, gdy brak wartości."""
    pairs = [(getattr(lr, attr), min(lr.bottom_cm, depth_cm) - lr.top_cm) for lr in layers if lr.top_cm < depth_cm]
    pairs = [(v, w) for v, w in pairs if v is not None and w > 0]
    return sum(v * w for v, w in pairs) / sum(w for _, w in pairs) if pairs else None


def ifs_features(rain_mm, t2m_c, sm_0_100cm, sm_analysis: float) -> list[dict]:
    """Cechy prognozy dla k = 0…13, jak pipeline/soil_moisture/dataset.forecast_features (narastająco od dnia t)."""
    rain, t2m, sm = (np.asarray(x, dtype=float) for x in (rain_mm, t2m_c, sm_0_100cm))
    week = rain[:FORECAST_WEEK_DAYS]
    rain_7d = float(week.sum()) if len(rain) >= FORECAST_WEEK_DAYS and np.isfinite(week).all() else math.nan
    out = []
    for k in range(len(rain)):
        out.append({"fc_rain_mm_to_k": float(np.nansum(rain[:k + 1])) if np.isfinite(rain[k]) else math.nan,
                    "fc_rain_mm_7d": rain_7d,
                    "fc_t2m_mean_to_k": float(np.nansum(t2m[:k + 1]) / (k + 1)),
                    "ifs_sm_analysis": float(sm_analysis),
                    "ifs_sm_change_to_k": float(sm[k] - sm_analysis)})
    return out


def soil_features(layers) -> dict:
    """Uziarnienie i węgiel 0–30 cm oraz FC i WP 0–100 cm, jak w treningu; brak gleby = NaN (model to obsługuje)."""
    if not layers:
        return dict.fromkeys(SOIL_FEATURES, math.nan)
    from app.core.soil import build_variants

    variant = build_variants(layers, ROOT_DEPTH_M)[0]
    values = (topsoil(layers, "sand_pct"), topsoil(layers, "clay_pct"), topsoil(layers, "soc_g_kg"),
              variant.fc_root, variant.wp_root)
    return {k: (math.nan if v is None else float(v)) for k, v in zip(SOIL_FEATURES, values)}


def _rounded_or_none(value) -> float | None:
    return None if isinstance(value, float) and math.isnan(value) else round(float(value), 4)


class SoilMoistureForecaster:
    """Model wilgotności v3 z jednego katalogu przebiegu. Plik modelu wczytuje się raz, przy pierwszej prognozie."""

    def __init__(self, directory: Path):
        self.directory = Path(directory)
        self._bundle: ModelBundle | None = None

    @classmethod
    @cache
    def default(cls) -> SoilMoistureForecaster:
        """Model przypięty w kowr_ml/models/CURRENT.json (albo wskazany przez KOWR_SM_MODEL_DIR), jeden na proces."""
        return cls(model_dir("soil_moisture"))

    @property
    def bundle(self) -> ModelBundle:
        if self._bundle is None:
            self._bundle = ModelBundle.load(self.directory)
        return self._bundle

    def predict(self, weather, ifs, soil_layers, t: date) -> dict:
        """{'available': True, 'points': [{date, delta_p50, delta_p10, delta_p90}], …} albo {'available': False, 'reason'}."""
        if not is_installed(self.directory):
            return {"available": False, "reason": NOT_INSTALLED}
        if weather is None or not len(weather.dates) or weather.dates[-1] != t - timedelta(days=1):
            return {"available": False, "reason": "seria pogody nie kończy się na wczorajszej dobie"}
        wf = WeatherSeries(list(weather.dates), weather.rain_mm, weather.et0_mm, weather.tmax_c).features(t)
        if wf is None:
            return {"available": False, "reason": "braki w pogodzie z ostatnich 30 dni"}
        base = {**wf, **doy_features(t), **soil_features(soil_layers)}
        rows = [{**base, **fc, "horizon_days": k}
                for k, fc in enumerate(ifs_features(ifs.rain_mm, ifs.t2m_c, ifs.sm_0_100cm, ifs.sm_analysis))]
        # Jak w treningu (wiersze bez opadu prognozy odpadają): prognoza kończy się przed pierwszą dobą bez opadu IFS.
        rows = rows[:next((k for k, row in enumerate(rows) if not math.isfinite(row["fc_rain_mm_to_k"])), len(rows))]
        if not rows:
            return {"available": False, "reason": "prognoza IFS nie ma opadu na dzisiejszą dobę"}
        return self._forecast(rows, t)

    def _forecast(self, rows: list[dict], t: date) -> dict:
        models, card = self.bundle.estimators, self.bundle.card
        X = np.array([[row.get(f, np.nan) for f in models["features"]] for row in rows], dtype=float)
        p50, lo, hi = (models[m].predict(X) for m in ("median", "p10", "p90"))
        adj = float(models.get("interval_adjust", 0.0))
        return {
            "available": True, "status": card.get("status"), "model_run": card.get("run_id"),
            "interval_coverage_test": card.get("metrics", {}).get("time", {}).get("interval_80_coverage"),
            "points": [{"date": t + timedelta(days=k), "delta_p50": float(p50[k]),
                        "delta_p10": float(min(lo[k], hi[k], p50[k]) - adj),
                        "delta_p90": float(max(lo[k], hi[k], p50[k]) + adj)}
                       for k in range(len(rows))],
            "inputs": {k: _rounded_or_none(v) for k, v in rows[0].items()},
        }
