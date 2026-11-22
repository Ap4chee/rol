"""Dopasowanie i ocena modelu wilgotności: HistGradientBoosting (mediana i kwantyle), strojenie, kalibracja przedziału.

Strojenie GroupKFold po skupisku; przedział 10–90% skalibrowany na prognozach spoza foldu.
Pliki, podziały i karta modelu są w train.py.
"""
from __future__ import annotations

import itertools

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.model_selection import GroupKFold

from kowr_ml.pipeline import config as C

GRID = {"learning_rate": [0.05, 0.1], "max_leaf_nodes": [15, 31], "min_samples_leaf": [50, 200],
        "l2_regularization": [0.0, 1.0]}
QUANTILES = (0.1, 0.9)
CV_SPLITS = 5


def mae(y, p) -> float:
    return float(np.mean(np.abs(np.asarray(y) - np.asarray(p))))


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
    gkf = GroupKFold(n_splits=min(CV_SPLITS, len(set(g))))
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
    for tr, va in GroupKFold(n_splits=min(CV_SPLITS, len(set(g)))).split(X, y, g):
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
