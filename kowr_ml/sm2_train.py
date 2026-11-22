"""Trening modelu wilgotności v2 i v3 (prognoza IFS + gleba); v1 (sm_train.py) zostaje bez zmian obok.

  python -m kowr_ml.sm2_train      – v2: cechy v1 (z ERA5-Land t−6) + prognoza IFS + gleba (i teren, gdy jest)
  python -m kowr_ml.sm2_train v3   – v3: bez ERA5-Land w cechach, etykieta od t−1 (sm3_dataset.py); ten trafia do aplikacji

Podział jak w v1: test przestrzenny (TEST_CLUSTERS), czasowy (TEST_SEASON) i łączny; strojenie GroupKFold po skupisku.
Na tych samych wierszach testowych porównujemy, przy tych samych hiperparametrach: zero (bez zmiany), seasonal
(dzień roku + wyprzedzenie, w v2 też θ z t−6), warianty z ABLATIONS danej wersji i pełny model (hgb).
Wynik: runs/<data>_<sm2|sm3>_<hash>/ z model.joblib, model_card.json, metrics.json, test_predictions.parquet.
"""
from __future__ import annotations

import hashlib
import json
import platform
import sys
from datetime import UTC, datetime

import joblib
import numpy as np
import pandas as pd
import sklearn

from . import config as C
from .sm2_dataset import FC_FEATURES, SM2_FEATURES
from .sm3_dataset import SM3_FEATURES, SM3_SEASONAL_FEATURES, SOIL_FEATURES, WEATHER_FEATURES
from .sm_dataset import BIG_DRY, SM_FEATURES, SM_LAG_DAYS, SM_SEASONAL_FEATURES
from .sm_train import QUANTILES, fit_set, interval_adjustment, make_model, metrics_block, predict_set, tune
from .static import STATIC_FEATURES

VARIANTS = {
    "v2": {
        "data": "training_sm2", "suffix": "sm2", "target": "sm_delta", "features": SM2_FEATURES,
        "seasonal": SM_SEASONAL_FEATURES, "lead": "lead_days",
        "ablations": {"v1_features": SM_FEATURES, "no_static": SM_FEATURES + FC_FEATURES},
        "name": "kowr_soil_moisture_0_100cm_t0_t13_v2",
        "target_text": f"θ(t+k) − θ(t−{SM_LAG_DAYS}) [m3/m3], k = 0…13; θ = dobowa średnia wilgotność gleby 0–100 cm "
                       "z ERA5-Land, doba Europe/Warsaw (jak v1)",
    },
    "v3": {
        "data": "training_sm3", "suffix": "sm3", "target": "sm3_delta", "features": SM3_FEATURES,
        "seasonal": SM3_SEASONAL_FEATURES, "lead": "horizon_days",
        "ablations": {"no_forecast": ["horizon_days", "day_of_year_sin", "day_of_year_cos"] + WEATHER_FEATURES + SOIL_FEATURES,
                      "no_static": ["horizon_days", "day_of_year_sin", "day_of_year_cos"] + WEATHER_FEATURES + FC_FEATURES},
        "name": "kowr_soil_moisture_0_100cm_t0_t13_v3",
        "target_text": "θ(t+k) − θ(t−1) [m3/m3], k = 0…13; θ = dobowa średnia wilgotność gleby 0–100 cm z ERA5-Land, "
                       "doba Europe/Warsaw; cechy bez ERA5-Land (stan gleby z analizy IFS)",
    },
}


def main(variant: str = "v2") -> None:
    v = VARIANTS[variant]
    target, ablations, seasonal = v["target"], v["ablations"], v["seasonal"]
    pred_cols = {"zero": "pred_zero", "seasonal": "pred_seasonal", **{k: f"pred_{k}" for k in ablations}, "hgb": "pred_hgb"}
    df = pd.read_parquet(C.DATA_DIR / f"{v['data']}.parquet")
    is_test_space = df["spatial_group"].isin(C.TEST_CLUSTERS)
    is_test_time = df["season"] == C.TEST_SEASON
    train = df[~is_test_space & ~is_test_time]
    tests = {"space": df[is_test_space & ~is_test_time], "time": df[~is_test_space & is_test_time],
             "space_and_time": df[is_test_space & is_test_time]}
    print(f"{variant}: trening {len(train)} wierszy; testy: " + ", ".join(f"{k} {len(p)}" for k, p in tests.items()), flush=True)
    # Cecha bez żadnej wartości (np. teren, gdy NMT nie odpowiadał) nie wchodzi do modelu; karta to zapisuje.
    features = [f for f in v["features"] if train[f].notna().any()]
    dropped = [f for f in v["features"] if f not in features]
    if dropped:
        print("pominięte cechy bez danych:", dropped, flush=True)

    params, grid_results = tune(train, features, target)
    print("najlepsze", params, flush=True)
    models = fit_set(train, params, features, seasonal, target)
    models["interval_adjust"] = interval_adjustment(train, params, features, target)
    y = train[target].to_numpy(float)
    ablation = {k: make_model(**params).fit(train[f].to_numpy(float), y) for k, f in ablations.items()}
    metrics, preds = {}, []
    for name, part in tests.items():
        if len(part) == 0:
            continue
        p = predict_set(models, part, features, seasonal)
        for k, f in ablations.items():
            p[f"pred_{k}"] = ablation[k].predict(part[f].to_numpy(float))
        metrics[name] = metrics_block(p, pred_cols, target, BIG_DRY)
        metrics[name]["mae_by_lead_days"] = {
            m: {int(k): float(e) for k, e in (p[target] - p[c]).abs().groupby(p[v["lead"]]).mean().items()}
            for m, c in pred_cols.items()}
        preds.append(p.assign(test=name))
    qualifies = all(metrics[k]["hgb"]["mae_rows"] < metrics[k]["zero"]["mae_rows"] for k in ("space", "time") if k in metrics)

    final = fit_set(df, params, features, seasonal, target)
    final_adjust = interval_adjustment(df, params, features, target)
    run_id = datetime.now(UTC).strftime("%Y%m%d_%H%M") + f"_{v['suffix']}_" + hashlib.sha1(
        json.dumps(params, sort_keys=True).encode()).hexdigest()[:6]
    run = C.RUNS_DIR / run_id
    run.mkdir(parents=True, exist_ok=True)
    joblib.dump({"median": final["median"], "p10": final["p10"], "p90": final["p90"], "features": features,
                 "interval_adjust": final_adjust}, run / "model.joblib")
    pd.concat(preds).to_parquet(run / "test_predictions.parquet", index=False)
    (run / "metrics.json").write_text(json.dumps({"params": params, "grid": grid_results, "tests": metrics}, indent=2))
    static = pd.read_parquet(C.DATA_DIR / "cluster_static.parquet")
    card = {
        "name": v["name"],
        "run_id": run_id,
        "status": "eksperymentalny" if qualifies else "niezakwalifikowany: nie bije prognozy „bez zmiany”",
        "previous_versions": "v1: sm_train.py, v2/v3: sm2_train.py; wszystkie bez zmian obok siebie",
        "target": v["target_text"],
        "units": "m3/m3",
        "features": features,
        "features_dropped_no_data": dropped,
        "quantiles": list(QUANTILES),
        "interval_adjust": final_adjust,
        "hyperparameters": params,
        "train_rows_evaluated_model": int(len(train)),
        "train_rows_final_model": int(len(df)),
        "seasons": sorted(int(s) for s in df["season"].unique()),
        "clusters": [c[0] for c in C.CLUSTERS_FIRST], "test_clusters": list(C.TEST_CLUSTERS), "test_season": C.TEST_SEASON,
        "dataset_stats": json.loads((C.DATA_DIR / f"dataset_{v['suffix']}_stats.json").read_text()),
        "static_missing": {c: int(static[c].isna().sum()) for c in STATIC_FEATURES},
        "metrics": {k: {m: e[m]["mae_rows"] for m in pred_cols} | {"interval_80_coverage": e.get("interval_80_coverage")}
                    for k, e in metrics.items()},
        "data": {
            "soil_moisture_label": "ERA5-Land z plików Open-Meteo (s3://openmeteo), CC BY 4.0",
            "weather_past": "ERA5 z plików Open-Meteo, ET0 FAO-56 (app/core/et0.py), CC BY 4.0",
            "forecast": "ECMWF IFS open data (s3://ecmwf-forecasts), przebieg 00 UTC z dnia t; 0,4° do 01.2024 "
                        "(bez wilgotności gleby), potem 0,25°; HRES do 240 h, dalsze doby z przebiegu kontrolnego "
                        "ensemble (kowr_ml/ifs.py fetch_extension); CC BY 4.0 i ECMWF Terms of Use",
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
    (run / "model_card.json").write_text(json.dumps(card, indent=2, ensure_ascii=False))
    print(json.dumps(card["metrics"], indent=2))
    print(f"zapisano {run}")


if __name__ == "__main__":
    main(*sys.argv[1:])
