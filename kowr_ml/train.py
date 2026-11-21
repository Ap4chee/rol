"""Trening HistGradientBoosting dla ΔNDMI i porównanie z baseline'ami (spec. sekcja 4).

Podział:
  - trening/strojenie: skupiska spoza TEST_CLUSTERS, sezony przed TEST_SEASON (GroupKFold po skupisku),
  - test przestrzenny: TEST_CLUSTERS, sezony przed TEST_SEASON,
  - test czasowy: skupiska treningowe, TEST_SEASON,
  - test łączny: TEST_CLUSTERS, TEST_SEASON.
Baseline'y: ΔNDMI = 0 oraz model sezonowy (dzień roku + ostatnie NDMI, ten sam algorytm).
Model trafia do aplikacji tylko wtedy, gdy bije ΔNDMI = 0 na obu testach; inaczej karta oznacza go jako
niezakwalifikowany. Przy niewielu sezonach zawsze jest oznaczony jako eksperymentalny.
Wynik: runs/<data>_<hash>/ z model.joblib, model_card.json, metrics.json, test_predictions.parquet.
"""
from __future__ import annotations

import hashlib
import itertools
import json
import platform
from datetime import datetime, timezone

import joblib
import numpy as np
import pandas as pd
import sklearn
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.model_selection import GroupKFold

from . import config as C
from .features import FEATURES, SEASONAL_FEATURES

GRID = {"learning_rate": [0.05, 0.1], "max_leaf_nodes": [15, 31], "min_samples_leaf": [50, 200],
        "l2_regularization": [0.0, 1.0]}
BIG_DROP = -0.05
QUANTILES = (0.1, 0.9)


def make_model(loss: str = "absolute_error", quantile: float | None = None, **params) -> HistGradientBoostingRegressor:
    kw = dict(loss=loss, max_iter=600, early_stopping=True, validation_fraction=0.15, n_iter_no_change=30,
              random_state=C.RANDOM_SEED, **params)
    if quantile is not None:
        kw["quantile"] = quantile
    return HistGradientBoostingRegressor(**kw)


def mae(y, p) -> float:
    return float(np.mean(np.abs(np.asarray(y) - np.asarray(p))))


def metrics_block(df: pd.DataFrame, pred_cols: dict[str, str]) -> dict:
    """MAE po wierszach i uśrednione po polach, według miesiąca i dla dużych spadków."""
    out = {"rows": int(len(df)), "fields": int(df["field_id"].nunique())}
    month = pd.to_datetime(df["issue_date"]).dt.month
    big = df["ndmi_delta"] <= BIG_DROP
    out["big_drop_rows"] = int(big.sum())
    for name, col in pred_cols.items():
        err = (df["ndmi_delta"] - df[col]).abs()
        out[name] = {
            "mae_rows": float(err.mean()),
            "mae_fields": float(err.groupby(df["field_id"]).mean().mean()),
            "mae_big_drop": float(err[big].mean()) if big.any() else None,
            "mae_by_month": {int(m): float(v) for m, v in err.groupby(month).mean().items()},
        }
    if "p10" in df and "p90" in df:
        inside = (df["ndmi_delta"] >= df["p10"]) & (df["ndmi_delta"] <= df["p90"])
        out["interval_80_coverage"] = float(inside.mean())
        out["interval_80_mean_width"] = float((df["p90"] - df["p10"]).mean())
    return out


def tune(train: pd.DataFrame) -> tuple[dict, list]:
    # Uczymy na tablicach numpy (kolejność jak w FEATURES): aplikacja podaje dane w tej samej postaci.
    X, y, g = train[FEATURES].to_numpy(float), train["ndmi_delta"].to_numpy(float), train["spatial_group"].to_numpy()
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


def interval_adjustment(train: pd.DataFrame, params: dict) -> float:
    """Kalibracja przedziału 10–90% (conformalized quantile regression, Romano i in. 2019).

    Na prognozach spoza foldu (GroupKFold po skupisku) liczymy, o ile trzeba poszerzyć przedział,
    żeby obejmował 80% obserwacji. Wartość dodajemy po obu stronach przy predykcji.
    """
    X, y, g = train[FEATURES].to_numpy(float), train["ndmi_delta"].to_numpy(float), train["spatial_group"].to_numpy()
    scores = np.empty(len(y))
    for tr, va in GroupKFold(n_splits=min(5, len(set(g)))).split(X, y, g):
        lo = make_model("quantile", QUANTILES[0], **params).fit(X[tr], y[tr]).predict(X[va])
        hi = make_model("quantile", QUANTILES[1], **params).fit(X[tr], y[tr]).predict(X[va])
        lo, hi = np.minimum(lo, hi), np.maximum(lo, hi)
        scores[va] = np.maximum(lo - y[va], y[va] - hi)
    level = QUANTILES[1] - QUANTILES[0]
    n = len(scores)
    return float(np.quantile(scores, min(1.0, np.ceil((n + 1) * level) / n)))


def fit_set(train: pd.DataFrame, params: dict) -> dict:
    X, y = train[FEATURES].to_numpy(float), train["ndmi_delta"].to_numpy(float)
    return {
        "median": make_model(**params).fit(X, y),
        "p10": make_model("quantile", QUANTILES[0], **params).fit(X, y),
        "p90": make_model("quantile", QUANTILES[1], **params).fit(X, y),
        "seasonal": make_model(**params).fit(train[SEASONAL_FEATURES].to_numpy(float), y),
    }


def predict_set(models: dict, df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    out["pred_zero"] = 0.0
    X = df[FEATURES].to_numpy(float)
    out["pred_seasonal"] = models["seasonal"].predict(df[SEASONAL_FEATURES].to_numpy(float))
    out["pred_hgb"] = models["median"].predict(X)
    lo, hi = models["p10"].predict(X), models["p90"].predict(X)
    adj = models.get("interval_adjust", 0.0)
    out["p10"], out["p90"] = np.minimum(lo, hi) - adj, np.maximum(lo, hi) + adj
    return out


def main() -> None:
    df = pd.read_parquet(C.DATA_DIR / "training.parquet")
    is_test_space = df["spatial_group"].isin(C.TEST_CLUSTERS)
    is_test_time = df["season"] == C.TEST_SEASON
    train = df[~is_test_space & ~is_test_time]
    tests = {"space": df[is_test_space & ~is_test_time], "time": df[~is_test_space & is_test_time],
             "space_and_time": df[is_test_space & is_test_time]}
    print(f"trening {len(train)} wierszy; testy: " + ", ".join(f"{k} {len(v)}" for k, v in tests.items()), flush=True)

    params, grid_results = tune(train)
    print("najlepsze", params, flush=True)
    models = fit_set(train, params)
    models["interval_adjust"] = interval_adjustment(train, params)
    print(f"poszerzenie przedziału {models['interval_adjust']:.4f}", flush=True)
    pred_cols = {"zero": "pred_zero", "seasonal": "pred_seasonal", "hgb": "pred_hgb"}
    metrics, preds = {}, []
    for name, part in tests.items():
        if len(part) == 0:
            continue
        p = predict_set(models, part)
        metrics[name] = metrics_block(p, pred_cols)
        preds.append(p.assign(test=name))
    qualifies = all(metrics[k]["hgb"]["mae_rows"] < metrics[k]["zero"]["mae_rows"] for k in ("space", "time") if k in metrics)

    # Model do aplikacji: ten sam zestaw hiperparametrów, dopasowany na wszystkich danych.
    final = fit_set(df, params)
    final_adjust = interval_adjustment(df, params)
    run_id = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M") + "_" + hashlib.sha1(
        json.dumps(params, sort_keys=True).encode()).hexdigest()[:6]
    run = C.RUNS_DIR / run_id
    run.mkdir(parents=True, exist_ok=True)
    joblib.dump({"median": final["median"], "p10": final["p10"], "p90": final["p90"], "features": FEATURES,
                 "interval_adjust": final_adjust}, run / "model.joblib")
    pd.concat(preds).to_parquet(run / "test_predictions.parquet", index=False)
    (run / "metrics.json").write_text(json.dumps({"params": params, "grid": grid_results, "tests": metrics}, indent=2))
    stats = json.loads((C.DATA_DIR / "dataset_stats.json").read_text())
    card = {
        "name": "kowr_ndmi_delta_7_14d",
        "run_id": run_id,
        "status": ("eksperymentalny" if qualifies else "niezakwalifikowany: nie bije prognozy ΔNDMI = 0"),
        "target": "ndmi_future - ndmi_last; ndmi_future = pierwsza zaakceptowana scena w t+7..t+14, "
                  "ndmi_last = ostatnia zaakceptowana scena w t-14..t-1",
        "features": FEATURES,
        "quantiles": list(QUANTILES),
        "interval_adjust": final_adjust,
        "hyperparameters": params,
        "train_rows_evaluated_model": int(len(train)),
        "train_rows_final_model": int(len(df)),
        "seasons": sorted(int(s) for s in df["season"].unique()),
        "clusters": [c[0] for c in C.CLUSTERS], "test_clusters": list(C.TEST_CLUSTERS), "test_season": C.TEST_SEASON,
        "dataset_stats": stats,
        "metrics": {k: {m: v[m]["mae_rows"] for m in pred_cols} | {"interval_80_coverage": v.get("interval_80_coverage")}
                    for k, v in metrics.items()},
        "thresholds": {"min_pixels": C.MIN_PIXELS, "min_coverage": C.MIN_COVERAGE, "scl": C.SCL_VEGETATION},
        "data": {
            "fields": f"ESA WorldCover 10 m 2021 v200, klasa {C.WORLDCOVER_CROPLAND}, kwadraty {C.FIELD_SIZE_M} m "
                      "(CC BY 4.0, © ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) "
                      "processed by ESA WorldCover consortium)",
            "sentinel2": f"{C.S2_COLLECTION} przez {C.STAC_URL} (Sentinel Data Legal Notice)",
            "weather": "Open-Meteo Historical Weather API, domyślny model, timezone Europe/Warsaw (dane CC BY 4.0)",
        },
        "versions": {"python": platform.python_version(), "scikit-learn": sklearn.__version__,
                     "numpy": np.__version__, "pandas": pd.__version__},
        "limits": [
            "Pola to fragmenty gruntów ornych z WorldCover 2021, nie granice deklarowanych upraw; typ uprawy nieznany.",
            "Pogoda z jednej komórki na skupisko; brak prognozy pogody na okno 7–14 dni.",
            "Model prognozuje zmianę wskaźnika satelitarnego, nie wilgotność gleby ani dawkę nawodnienia.",
            "Zbiór nadreprezentuje okresy z dobrą widocznością roślinności (próg chmur i SCL).",
        ],
    }
    (run / "model_card.json").write_text(json.dumps(card, indent=2, ensure_ascii=False))
    print(json.dumps(card["metrics"], indent=2))
    print(f"zapisano {run}")


if __name__ == "__main__":
    main()
