"""Trening wdrożonego modelu wilgotności gleby v3 na training_sm3.parquet (dataset.py) -> runs/<data>_sm3_<hash>/.

  python -m kowr_ml.pipeline.soil_moisture.train

Podział: test przestrzenny (TEST_CLUSTERS), czasowy (TEST_SEASON) i łączny; strojenie GroupKFold po skupisku.
Na tych samych wierszach testowych porównujemy, przy tych samych hiperparametrach: zero (bez zmiany), seasonal
(dzień roku + wyprzedzenie), warianty z ABLATIONS i pełny model (hgb). Model jest „niezakwalifikowany”, jeśli nie bije
prognozy bez zmiany. Wynik: model.joblib, model_card.json, metrics.json, test_predictions.parquet.
"""
from __future__ import annotations

import hashlib
import json
import platform
from datetime import UTC, datetime

import joblib
import numpy as np
import pandas as pd
import sklearn

from kowr_ml.pipeline import config as C
from kowr_ml.pipeline.soil_moisture.dataset import (
    BIG_DRY,
    CALENDAR_FEATURES,
    FC_FEATURES,
    FEATURES,
    SEASONAL_FEATURES,
    SOIL_FEATURES,
    TARGET,
    WEATHER_FEATURES,
)
from kowr_ml.pipeline.soil_moisture.fitting import (
    QUANTILES,
    fit_set,
    interval_adjustment,
    make_model,
    metrics_block,
    predict_set,
    tune,
)
from kowr_ml.pipeline.soil_moisture.static import STATIC_FEATURES

NAME = "kowr_soil_moisture_0_100cm_t0_t13_v3"
RUN_SUFFIX = "sm3"
LEAD = "horizon_days"
ABLATIONS = {"no_forecast": CALENDAR_FEATURES + WEATHER_FEATURES + list(SOIL_FEATURES),
             "no_static": CALENDAR_FEATURES + WEATHER_FEATURES + FC_FEATURES}
PRED_COLS = {"zero": "pred_zero", "seasonal": "pred_seasonal", **{k: f"pred_{k}" for k in ABLATIONS}, "hgb": "pred_hgb"}
TARGET_TEXT = ("θ(t+k) − θ(t−1) [m3/m3], k = 0…13; θ = dobowa średnia wilgotność gleby 0–100 cm z ERA5-Land, "
               "doba Europe/Warsaw; cechy bez ERA5-Land (stan gleby z analizy IFS)")


def split(df: pd.DataFrame) -> tuple[pd.DataFrame, dict[str, pd.DataFrame]]:
    is_test_space = df["spatial_group"].isin(C.TEST_CLUSTERS)
    is_test_time = df["season"] == C.TEST_SEASON
    tests = {"space": df[is_test_space & ~is_test_time], "time": df[~is_test_space & is_test_time],
             "space_and_time": df[is_test_space & is_test_time]}
    return df[~is_test_space & ~is_test_time], tests


def evaluate(train: pd.DataFrame, tests: dict[str, pd.DataFrame], params: dict, features: list[str]) -> tuple[dict, list]:
    """Metryki modelu, punktów odniesienia i ablacji na każdym teście oraz prognozy testowe."""
    models = fit_set(train, params, features, SEASONAL_FEATURES, TARGET)
    models["interval_adjust"] = interval_adjustment(train, params, features, TARGET)
    y = train[TARGET].to_numpy(float)
    ablation = {k: make_model(**params).fit(train[f].to_numpy(float), y) for k, f in ABLATIONS.items()}
    metrics, preds = {}, []
    for name, part in tests.items():
        if len(part) == 0:
            continue
        p = predict_set(models, part, features, SEASONAL_FEATURES)
        for k, f in ABLATIONS.items():
            p[f"pred_{k}"] = ablation[k].predict(part[f].to_numpy(float))
        metrics[name] = metrics_block(p, PRED_COLS, TARGET, BIG_DRY)
        # błąd według dnia horyzontu: t+0 … t+13 to kolejne punkty linii prognozy na wykresie
        metrics[name]["mae_by_lead_days"] = {
            m: {int(k): float(e) for k, e in (p[TARGET] - p[c]).abs().groupby(p[LEAD]).mean().items()}
            for m, c in PRED_COLS.items()}
        preds.append(p.assign(test=name))
    return metrics, preds


def model_card(run_id: str, df: pd.DataFrame, train: pd.DataFrame, params: dict, features: list[str],
               dropped: list[str], adjust: float, metrics: dict) -> dict:
    qualifies = all(metrics[k]["hgb"]["mae_rows"] < metrics[k]["zero"]["mae_rows"] for k in ("space", "time") if k in metrics)
    static = pd.read_parquet(C.DATA_DIR / "cluster_static.parquet")
    return {
        "name": NAME,
        "run_id": run_id,
        "status": "eksperymentalny" if qualifies else "niezakwalifikowany: nie bije prognozy „bez zmiany”",
        "previous_versions": "v1 i v2 (z θ ERA5-Land z t−6 w cechach): wyniki w README, kod w historii gita",
        "target": TARGET_TEXT,
        "units": "m3/m3",
        "features": features,
        "features_dropped_no_data": dropped,
        "quantiles": list(QUANTILES),
        "interval_adjust": adjust,
        "hyperparameters": params,
        "train_rows_evaluated_model": int(len(train)),
        "train_rows_final_model": int(len(df)),
        "seasons": sorted(int(s) for s in df["season"].unique()),
        "clusters": [c[0] for c in C.CLUSTERS_FIRST], "test_clusters": list(C.TEST_CLUSTERS), "test_season": C.TEST_SEASON,
        "dataset_stats": json.loads((C.DATA_DIR / f"dataset_{RUN_SUFFIX}_stats.json").read_text()),
        "static_missing": {c: int(static[c].isna().sum()) for c in STATIC_FEATURES},
        "metrics": {k: {m: e[m]["mae_rows"] for m in PRED_COLS} | {"interval_80_coverage": e.get("interval_80_coverage")}
                    for k, e in metrics.items()},
        "data": {
            "soil_moisture_label": "ERA5-Land z plików Open-Meteo (s3://openmeteo), CC BY 4.0",
            "weather_past": "ERA5 z plików Open-Meteo, ET0 FAO-56 (app/core/et0.py), CC BY 4.0",
            "forecast": "ECMWF IFS open data (s3://ecmwf-forecasts), przebieg 00 UTC z dnia t; 0,4° do 01.2024 "
                        "(bez wilgotności gleby), potem 0,25°; HRES do 240 h, dalsze doby z przebiegu kontrolnego "
                        "ensemble (kowr_ml/pipeline/soil_moisture/ifs.py fetch_extension); CC BY 4.0 i ECMWF Terms of Use",
            "soil": "ISRIC SoilGrids 250 m (app/sources/soilgrids.py) + Saxton–Rawls 2006, działka umowna 200 × 200 m",
            "terrain": "NMT GUGiK 1 m (app/sources/terrain.py), spadek po wygładzeniu 5 m",
        },
        "versions": {"python": platform.python_version(), "scikit-learn": sklearn.__version__,
                     "numpy": np.__version__, "pandas": pd.__version__},
        "limits": [
            "Etykieta to reanaliza ERA5-Land dla komórki ok. 9 km. ERA5-Land nie ma spływu bocznego, więc teren "
            "działki nie może wpływać na etykietę, a gleba tylko przez korelację z glebą komórki.",
            "Gleba jest stała dla skupiska: przy 20 skupiskach model może jej użyć jako identyfikatora miejsca; "
            "rozstrzyga test na odłożonych skupiskach i porównanie z wariantem no_static.",
            "Prognoza IFS: doby UTC wobec dób Europe/Warsaw w etykiecie; wilgotność z IFS dopiero od 02.2024.",
        ],
    }


def main() -> None:
    df = pd.read_parquet(C.DATA_DIR / "training_sm3.parquet")
    train, tests = split(df)
    print(f"trening {len(train)} wierszy; testy: " + ", ".join(f"{k} {len(p)}" for k, p in tests.items()), flush=True)
    # Cecha bez żadnej wartości (np. teren, gdy NMT nie odpowiadał) nie wchodzi do modelu; karta to zapisuje.
    features = [f for f in FEATURES if train[f].notna().any()]
    dropped = [f for f in FEATURES if f not in features]
    if dropped:
        print("pominięte cechy bez danych:", dropped, flush=True)

    params, grid_results = tune(train, features, TARGET)
    print("najlepsze", params, flush=True)
    metrics, preds = evaluate(train, tests, params, features)

    # Model do aplikacji: te same hiperparametry, dopasowany na wszystkich danych.
    final = fit_set(df, params, features, SEASONAL_FEATURES, TARGET)
    final_adjust = interval_adjustment(df, params, features, TARGET)
    run_id = datetime.now(UTC).strftime("%Y%m%d_%H%M") + f"_{RUN_SUFFIX}_" + hashlib.sha1(
        json.dumps(params, sort_keys=True).encode()).hexdigest()[:6]
    run = C.RUNS_DIR / run_id
    run.mkdir(parents=True, exist_ok=True)
    joblib.dump({"median": final["median"], "p10": final["p10"], "p90": final["p90"], "features": features,
                 "interval_adjust": final_adjust}, run / "model.joblib")
    pd.concat(preds).to_parquet(run / "test_predictions.parquet", index=False)
    (run / "metrics.json").write_text(json.dumps({"params": params, "grid": grid_results, "tests": metrics}, indent=2))
    card = model_card(run_id, df, train, params, features, dropped, final_adjust, metrics)
    (run / "model_card.json").write_text(json.dumps(card, indent=2, ensure_ascii=False))
    print(json.dumps(card["metrics"], indent=2))
    print(f"zapisano {run}; do aplikacji: skopiuj do kowr_ml/models/soil_moisture/ i wpisz w models/CURRENT.json")


if __name__ == "__main__":
    main()
