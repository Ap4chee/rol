"""Trening modelu prognozy wilgotności gleby 0–100 cm (ERA5-Land) na dni t … t+13; etykieta w sm_dataset.py.

Strojenie GroupKFold po skupisku, test przestrzenny (TEST_CLUSTERS),
czasowy (TEST_SEASON) i łączny, baseline'y „bez zmiany” (θ jak w t−6) i sezonowy, przedział 10–90%
skalibrowany na prognozach spoza foldu. Model jest „niezakwalifikowany”, jeśli nie bije prognozy bez zmiany.
Wynik: runs/<data>_sm_<hash>/ z model.joblib, model_card.json, metrics.json, test_predictions.parquet.
"""
from __future__ import annotations

import hashlib
import itertools
import json
import platform
from datetime import UTC, datetime

import joblib
import numpy as np
import pandas as pd
import sklearn
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.model_selection import GroupKFold

from . import config as C
from .sm_dataset import BIG_DRY, HORIZON_DAYS, ISSUE_STEP_DAYS, SM_FEATURES, SM_LAG_DAYS, SM_SEASONAL_FEATURES

TARGET = "sm_delta"
PRED_COLS = {"zero": "pred_zero", "seasonal": "pred_seasonal", "hgb": "pred_hgb"}


GRID = {"learning_rate": [0.05, 0.1], "max_leaf_nodes": [15, 31], "min_samples_leaf": [50, 200],
        "l2_regularization": [0.0, 1.0]}
QUANTILES = (0.1, 0.9)


def make_model(loss: str = "absolute_error", quantile: float | None = None, **params) -> HistGradientBoostingRegressor:
    kw = dict(loss=loss, max_iter=600, early_stopping=True, validation_fraction=0.15, n_iter_no_change=30,
              random_state=C.RANDOM_SEED, **params)
    if quantile is not None:
        kw["quantile"] = quantile
    return HistGradientBoostingRegressor(**kw)


def metrics_block(df: pd.DataFrame, pred_cols: dict[str, str], target: str, big_drop: float) -> dict:
    """MAE po wierszach i uśrednione po polach, według miesiąca i dla dużych spadków."""
    out = {"rows": int(len(df)), "fields": int(df["field_id"].nunique())}
    month = pd.to_datetime(df["issue_date"]).dt.month
    big = df[target] <= big_drop
    out["big_drop_rows"] = int(big.sum())
    for name, col in pred_cols.items():
        err = (df[target] - df[col]).abs()
        out[name] = {
            "mae_rows": float(err.mean()),
            "mae_fields": float(err.groupby(df["field_id"]).mean().mean()),
            "mae_big_drop": float(err[big].mean()) if big.any() else None,
            "mae_by_month": {int(m): float(v) for m, v in err.groupby(month).mean().items()},
        }
    if "p10" in df and "p90" in df:
        inside = (df[target] >= df["p10"]) & (df[target] <= df["p90"])
        out["interval_80_coverage"] = float(inside.mean())
        out["interval_80_mean_width"] = float((df["p90"] - df["p10"]).mean())
    return out


def tune(train: pd.DataFrame, features: list[str], target: str) -> tuple[dict, list]:
    # Uczymy na tablicach numpy (kolejność jak w FEATURES): aplikacja podaje dane w tej samej postaci.
    X, y, g = train[features].to_numpy(float), train[target].to_numpy(float), train["spatial_group"].to_numpy()
    gkf = GroupKFold(n_splits=min(5, len(set(g))))
    results = []
    for values in itertools.product(*GRID.values()):
        params = dict(zip(GRID.keys(), values))
        errs = []
        for tr, va in gkf.split(X, y, g):
            m = make_model(**params).fit(X[tr], y[tr])
            errs.append(mae(y[va], m.predict(X[va])))
        results.append({**params, "cv_mae": float(np.mean(errs))})
        print(params, f"cv MAE {np.mean(errs):.4f}", flush=True)
    best = min(results, key=lambda r: r["cv_mae"])
    return {k: best[k] for k in GRID}, results


def interval_adjustment(train: pd.DataFrame, params: dict, features: list[str], target: str) -> float:
    """Kalibracja przedziału 10–90% (conformalized quantile regression, Romano i in. 2019).

    Na prognozach spoza foldu (GroupKFold po skupisku) liczymy, o ile trzeba poszerzyć przedział,
    żeby obejmował 80% obserwacji. Wartość dodajemy po obu stronach przy predykcji.
    """
    X, y, g = train[features].to_numpy(float), train[target].to_numpy(float), train["spatial_group"].to_numpy()
    scores = np.empty(len(y))
    for tr, va in GroupKFold(n_splits=min(5, len(set(g)))).split(X, y, g):
        lo = make_model("quantile", QUANTILES[0], **params).fit(X[tr], y[tr]).predict(X[va])
        hi = make_model("quantile", QUANTILES[1], **params).fit(X[tr], y[tr]).predict(X[va])
        lo, hi = np.minimum(lo, hi), np.maximum(lo, hi)
        scores[va] = np.maximum(lo - y[va], y[va] - hi)
    level = QUANTILES[1] - QUANTILES[0]
    n = len(scores)
    return float(np.quantile(scores, min(1.0, np.ceil((n + 1) * level) / n)))


def fit_set(train: pd.DataFrame, params: dict, features: list[str], seasonal: list[str], target: str) -> dict:
    X, y = train[features].to_numpy(float), train[target].to_numpy(float)
    return {
        "median": make_model(**params).fit(X, y),
        "p10": make_model("quantile", QUANTILES[0], **params).fit(X, y),
        "p90": make_model("quantile", QUANTILES[1], **params).fit(X, y),
        "seasonal": make_model(**params).fit(train[seasonal].to_numpy(float), y),
    }


def predict_set(models: dict, df: pd.DataFrame, features: list[str], seasonal: list[str]) -> pd.DataFrame:
    out = df.copy()
    out["pred_zero"] = 0.0
    X = df[features].to_numpy(float)
    out["pred_seasonal"] = models["seasonal"].predict(df[seasonal].to_numpy(float))
    out["pred_hgb"] = models["median"].predict(X)
    lo, hi = models["p10"].predict(X), models["p90"].predict(X)
    adj = models.get("interval_adjust", 0.0)
    out["p10"], out["p90"] = np.minimum(lo, hi) - adj, np.maximum(lo, hi) + adj
    return out


def main() -> None:
    df = pd.read_parquet(C.DATA_DIR / "training_sm.parquet")
    is_test_space = df["spatial_group"].isin(C.TEST_CLUSTERS)
    is_test_time = df["season"] == C.TEST_SEASON
    train = df[~is_test_space & ~is_test_time]
    tests = {"space": df[is_test_space & ~is_test_time], "time": df[~is_test_space & is_test_time],
             "space_and_time": df[is_test_space & is_test_time]}
    print(f"trening {len(train)} wierszy; testy: " + ", ".join(f"{k} {len(v)}" for k, v in tests.items()), flush=True)

    params, grid_results = tune(train, SM_FEATURES, TARGET)
    print("najlepsze", params, flush=True)
    models = fit_set(train, params, SM_FEATURES, SM_SEASONAL_FEATURES, TARGET)
    models["interval_adjust"] = interval_adjustment(train, params, SM_FEATURES, TARGET)
    metrics, preds = {}, []
    for name, part in tests.items():
        if len(part) == 0:
            continue
        p = predict_set(models, part, SM_FEATURES, SM_SEASONAL_FEATURES)
        metrics[name] = metrics_block(p, PRED_COLS, TARGET, BIG_DRY)
        # błąd według dnia horyzontu: t+0 … t+13 to kolejne punkty linii prognozy na wykresie
        metrics[name]["mae_by_lead_days"] = {
            m: {int(k): float(v) for k, v in (p[TARGET] - p[c]).abs().groupby(p["lead_days"]).mean().items()}
            for m, c in PRED_COLS.items()}
        preds.append(p.assign(test=name))
    qualifies = all(metrics[k]["hgb"]["mae_rows"] < metrics[k]["zero"]["mae_rows"] for k in ("space", "time") if k in metrics)

    # Model do aplikacji: te same hiperparametry, dopasowany na wszystkich danych.
    final = fit_set(df, params, SM_FEATURES, SM_SEASONAL_FEATURES, TARGET)
    final_adjust = interval_adjustment(df, params, SM_FEATURES, TARGET)
    run_id = datetime.now(UTC).strftime("%Y%m%d_%H%M") + "_sm_" + hashlib.sha1(
        json.dumps(params, sort_keys=True).encode()).hexdigest()[:6]
    run = C.RUNS_DIR / run_id
    run.mkdir(parents=True, exist_ok=True)
    joblib.dump({"median": final["median"], "p10": final["p10"], "p90": final["p90"], "features": SM_FEATURES,
                 "interval_adjust": final_adjust}, run / "model.joblib")
    pd.concat(preds).to_parquet(run / "test_predictions.parquet", index=False)
    (run / "metrics.json").write_text(json.dumps({"params": params, "grid": grid_results, "tests": metrics}, indent=2))
    card = {
        "name": "kowr_soil_moisture_0_100cm_t0_t13",
        "run_id": run_id,
        "status": "eksperymentalny" if qualifies else "niezakwalifikowany: nie bije prognozy „bez zmiany”",
        "target": (f"θ(t+k) − θ(t−{SM_LAG_DAYS}) [m3/m3], k = 0…13; θ = dobowa średnia wilgotność gleby 0–100 cm "
                   "z ERA5-Land (warstwy 0–7, 7–28, 28–100 cm ważone grubością), doba Europe/Warsaw"),
        "units": "m3/m3",
        "features": SM_FEATURES,
        "quantiles": list(QUANTILES),
        "interval_adjust": final_adjust,
        "hyperparameters": params,
        "sm_lag_days": SM_LAG_DAYS, "horizon_days": list(HORIZON_DAYS), "issue_step_days": ISSUE_STEP_DAYS,
        "train_rows_evaluated_model": int(len(train)),
        "train_rows_final_model": int(len(df)),
        "seasons": sorted(int(s) for s in df["season"].unique()),
        "clusters": [c[0] for c in C.CLUSTERS_FIRST], "test_clusters": list(C.TEST_CLUSTERS), "test_season": C.TEST_SEASON,
        "dataset_stats": json.loads((C.DATA_DIR / "dataset_sm_stats.json").read_text()),
        "metrics": {k: {m: v[m]["mae_rows"] for m in PRED_COLS} | {"interval_80_coverage": v.get("interval_80_coverage")}
                    for k, v in metrics.items()},
        "data": {
            "soil_moisture": "ERA5-Land (Copernicus/ECMWF), godzinowe soil_moisture_0_to_7cm, _7_to_28cm, _28_to_100cm "
                             "z plików Open-Meteo w s3://openmeteo/data/copernicus_era5_land/, siatka 0,1°",
            "weather": "ERA5 (Copernicus/ECMWF) z s3://openmeteo/data/copernicus_era5/, siatka 0,25°: opad, Tmax/Tmin; "
                       "ET0 policzone wzorem FAO-56 (app/core/et0.py) z promieniowania, wiatru i punktu rosy",
        },
        "versions": {"python": platform.python_version(), "scikit-learn": sklearn.__version__,
                     "numpy": np.__version__, "pandas": pd.__version__},
        "limits": [
            "Etykieta to wilgotność z modelu reanalizy ERA5-Land dla komórki ok. 9 km, nie pomiar na działce; "
            "model nie zna gleby ani uprawy działki.",
            "Bez prognozy pogody: cechy kończą się na t−1, więc model nie przewiduje skutków deszczu z dni t … t+13.",
            "Pogoda w treningu to ERA5 z własnym ET0, a w aplikacji Open-Meteo (best match, ich ET0): możliwe przesunięcie.",
            "Jedna komórka na skupisko: 20 lokalizacji w Polsce, sezony z config.SEASONS.",
        ],
    }
    (run / "model_card.json").write_text(json.dumps(card, indent=2, ensure_ascii=False))
    print(json.dumps(card["metrics"], indent=2))
    print(json.dumps({k: {m: v["mae_by_lead_days"][m] for m in ("zero", "hgb")} for k, v in metrics.items()}, indent=2))
    print(f"zapisano {run}")


if __name__ == "__main__":
    main()
