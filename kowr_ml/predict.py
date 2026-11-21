"""Predykcja zmiany NDMI dla działki i daty z danych, które aplikacja i tak pobiera (bez dodatkowych zapytań).

Wejście: obserwacje Sentinel-2 z app/sources/sentinel.py (Observation: date, ndmi, valid_pixels, total_pixels,
accepted) i seria pogody z app/sources/weather.py (DailyWeather). Dzień prognozy t = data analizy:
obserwacje i pogoda tylko do t-1, prognoza dotyczy okna t+7 … t+14.
Bez danych wejściowych zwracamy powód zamiast prognozy (AGENTS.md, „Model ML”).
"""
from __future__ import annotations

import json
import os
from datetime import date, timedelta
from functools import lru_cache
from pathlib import Path

import numpy as np

from . import config as C
from .features import WeatherSeries, feature_row

MODEL_DIR_ENV = "KOWR_ML_MODEL_DIR"


def default_model_dir() -> Path | None:
    env = os.environ.get(MODEL_DIR_ENV)
    if env:
        return Path(env)
    candidates = sorted(p for p in (Path(__file__).resolve().parent / "model").glob("*") if (p / "model.joblib").exists())
    return candidates[-1] if candidates else None


@lru_cache(maxsize=2)
def load(model_dir: str) -> tuple[dict, dict]:
    import joblib
    d = Path(model_dir)
    return joblib.load(d / "model.joblib"), json.loads((d / "model_card.json").read_text(encoding="utf-8"))


def in_season(t: date) -> bool:
    first = date.fromisoformat(f"{t.year}-{C.ISSUE_FIRST}")
    last = date.fromisoformat(f"{t.year}-{C.ISSUE_LAST}")
    return first <= t <= last


def predict(observations: list, weather, t: date, model_dir: str | Path | None = None) -> dict:
    """Wynik do raportu: {'available': True, ...} albo {'available': False, 'reason': ...}."""
    model_dir = model_dir or default_model_dir()
    if model_dir is None or not (Path(model_dir) / "model.joblib").exists():
        return {"available": False, "reason": "model prognozy nie jest zainstalowany"}
    if not in_season(t):
        return {"available": False, "reason": (
            f"poza okresem, na którym model był uczony ({C.ISSUE_FIRST[3:]}.{C.ISSUE_FIRST[:2]}–"
            f"{C.ISSUE_LAST[3:]}.{C.ISSUE_LAST[:2]}); poza sezonem wegetacji zmiana NDMI nie mówi o stanie upraw")}
    accepted = sorted((o for o in observations if o.accepted and o.ndmi is not None and o.total_pixels),
                      key=lambda o: o.date)
    if not accepted:
        return {"available": False, "reason": "brak czystego zdjęcia satelitarnego działki z wartością NDMI"}
    d = np.array([o.date for o in accepted], dtype="datetime64[D]")
    nd = np.array([o.ndmi for o in accepted], dtype=float)
    fr = np.array([o.valid_pixels / o.total_pixels for o in accepted], dtype=float)
    if weather is None:
        return {"available": False, "reason": "brak serii pogodowej"}
    ws = WeatherSeries(list(weather.dates), weather.rain_mm, weather.et0_mm, weather.tmax_c)
    row = feature_row(d, nd, fr, ws, t)
    if row is None:
        lo, hi = C.LAST_WINDOW_DAYS
        last = str(d[-1])
        return {"available": False, "reason": (
            f"ostatnie czyste zdjęcie z {last}, a model wymaga zdjęcia z {hi} dni przed datą analizy "
            f"albo braki w pogodzie z ostatnich 30 dni")}
    models, card = load(str(model_dir))
    # Tablica numpy w kolejności cech z modelu: aplikacja nie potrzebuje pandas.
    X = np.array([[row.get(k, np.nan) for k in models["features"]]], dtype=float)
    p50 = float(models["median"].predict(X)[0])
    lo_, hi_ = float(models["p10"].predict(X)[0]), float(models["p90"].predict(X)[0])
    adj = float(models.get("interval_adjust", 0.0))  # kalibracja przedziału z treningu (train.interval_adjustment)
    p10, p90 = min(lo_, hi_, p50) - adj, max(lo_, hi_, p50) + adj
    k = row["_last_index"]
    return {
        "available": True,
        "status": card.get("status"),
        "model_run": card.get("run_id"),
        "window_from": (t + timedelta(days=C.TARGET_WINDOW_DAYS[0])).isoformat(),
        "window_to": (t + timedelta(days=C.TARGET_WINDOW_DAYS[1])).isoformat(),
        "ndmi_last": round(row["ndmi_last"], 3),
        "last_scene_date": str(d[k]),
        "last_scene_age_days": int(row["days_since_last_scene"]),
        "delta_p50": round(p50, 3), "delta_p10": round(p10, 3), "delta_p90": round(p90, 3),
        "inputs": {key: (None if isinstance(v, float) and np.isnan(v) else round(float(v), 3))
                   for key, v in row.items() if not key.startswith("_")},
    }
