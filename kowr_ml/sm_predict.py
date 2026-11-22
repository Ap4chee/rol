"""Predykcja modelu wilgotności gleby v3 (sm2_train.py v3) dla działki i dnia t: zmiana θ 0–100 cm od t−1 na dni t … t+13.

Wejścia, które aplikacja i tak ma, plus prognoza IFS (app/sources/ifs_forecast.py):
  pogoda dzienna do t−1 (DailyWeather: dates, rain_mm, et0_mm, tmax_c), warstwy gleby z SoilGrids (albo None),
  prognoza IFS wydana w dniu t. Bez pandas: aplikacja go nie potrzebuje.
Bez danych wejściowych zwracamy powód zamiast prognozy (AGENTS.md, „Model ML”).
"""
from __future__ import annotations

import json
import math
import os
from datetime import date, timedelta
from functools import lru_cache
from pathlib import Path

import numpy as np

from .features import WeatherSeries, doy_features

MODEL_DIR_ENV = "KOWR_SM_MODEL_DIR"
MODEL_ROOT = Path(__file__).resolve().parent / "model_sm"
ROOT_DEPTH_M = 1.0   # gleba w treningu: FC i WP średnie 0–100 cm (static.py)


def default_model_dir() -> Path | None:
    env = os.environ.get(MODEL_DIR_ENV)
    if env:
        return Path(env)
    runs = sorted(p for p in MODEL_ROOT.glob("*") if (p / "model.joblib").exists())
    return runs[-1] if runs else None


@lru_cache(maxsize=2)
def load(model_dir: str) -> tuple[dict, dict]:
    import joblib
    d = Path(model_dir)
    return joblib.load(d / "model.joblib"), json.loads((d / "model_card.json").read_text(encoding="utf-8"))


def ifs_features(rain_mm, t2m_c, sm_0_100cm, sm_analysis: float) -> list[dict]:
    """Cechy prognozy dla k = 0…13, jak sm2_dataset.forecast_features (sumy i średnie narastające od dnia t)."""
    rain, t2m, sm = (np.asarray(x, dtype=float) for x in (rain_mm, t2m_c, sm_0_100cm))
    rain_7d = float(rain[:7].sum()) if len(rain) >= 7 and np.isfinite(rain[:7]).all() else math.nan
    out = []
    for k in range(len(rain)):
        out.append({"fc_rain_mm_to_k": float(np.nansum(rain[:k + 1])) if np.isfinite(rain[k]) else math.nan,
                    "fc_rain_mm_7d": rain_7d,
                    "fc_t2m_mean_to_k": float(np.nansum(t2m[:k + 1]) / (k + 1)),
                    "ifs_sm_analysis": float(sm_analysis),
                    "ifs_sm_change_to_k": float(sm[k] - sm_analysis)})
    return out


def soil_features(layers) -> dict:
    """Uziarnienie i węgiel 0–30 cm oraz FC i WP 0–100 cm, jak static.py; brak gleby = NaN (model to obsługuje)."""
    keys = ("soil_sand_pct", "soil_clay_pct", "soil_soc_g_kg", "soil_fc_m3m3", "soil_wp_m3m3")
    if not layers:
        return dict.fromkeys(keys, math.nan)
    from app.core.soil import build_variants

    from .static import topsoil
    variant = build_variants(layers, ROOT_DEPTH_M)[0]
    values = (topsoil(layers, "sand_pct"), topsoil(layers, "clay_pct"), topsoil(layers, "soc_g_kg"),
              variant.fc_root, variant.wp_root)
    return {k: (math.nan if v is None else float(v)) for k, v in zip(keys, values)}


def predict(weather, ifs, soil_layers, t: date, model_dir: str | Path | None = None) -> dict:
    """{'available': True, 'points': [{date, delta_p50, delta_p10, delta_p90}], …} albo {'available': False, 'reason'}."""
    model_dir = model_dir or default_model_dir()
    if model_dir is None or not (Path(model_dir) / "model.joblib").exists():
        return {"available": False, "reason": "model prognozy wilgotności nie jest zainstalowany"}
    if weather is None or not len(weather.dates) or weather.dates[-1] != t - timedelta(days=1):
        return {"available": False, "reason": "seria pogody nie kończy się na wczorajszej dobie"}
    wf = WeatherSeries(list(weather.dates), weather.rain_mm, weather.et0_mm, weather.tmax_c).features(t)
    if wf is None:
        return {"available": False, "reason": "braki w pogodzie z ostatnich 30 dni"}
    models, card = load(str(model_dir))
    base = {**wf, **doy_features(t), **soil_features(soil_layers)}
    rows = [{**base, **fc, "horizon_days": k}
            for k, fc in enumerate(ifs_features(ifs.rain_mm, ifs.t2m_c, ifs.sm_0_100cm, ifs.sm_analysis))]
    # jak w treningu (wiersze bez opadu prognozy odpadają): prognoza kończy się przed pierwszą dobą bez opadu IFS
    rows = rows[:next((k for k, row in enumerate(rows) if not math.isfinite(row["fc_rain_mm_to_k"])), len(rows))]
    if not rows:
        return {"available": False, "reason": "prognoza IFS nie ma opadu na dzisiejszą dobę"}
    X = np.array([[row.get(f, np.nan) for f in models["features"]] for row in rows], dtype=float)
    p50, lo, hi = (models[m].predict(X) for m in ("median", "p10", "p90"))
    adj = float(models.get("interval_adjust", 0.0))
    return {
        "available": True, "status": card.get("status"), "model_run": card.get("run_id"),
        "interval_coverage_test": card.get("metrics", {}).get("time", {}).get("interval_80_coverage"),
        "points": [{"date": t + timedelta(days=k), "delta_p50": float(p50[k]),
                    "delta_p10": float(min(lo[k], hi[k], p50[k]) - adj), "delta_p90": float(max(lo[k], hi[k], p50[k]) + adj)}
                   for k in range(len(rows))],
        "inputs": {k: (None if isinstance(v, float) and math.isnan(v) else round(float(v), 4)) for k, v in rows[0].items()},
    }
