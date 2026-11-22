"""Trening HistGradientBoosting dla ΔNDMI, ocena i porównanie z punktami odniesienia (spec. sekcja 4).

Ocena na prognozach spoza foldu, zawsze dla pól ze skupisk, których model w danym dopasowaniu nie widział:
  - nowe miejsce (`spatial`): 5 foldów po skupisku, wszystkie sezony w treningu. To sytuacja aplikacji dla dat
    z lat 2017–2026: działka jest nowa, ale sezon model zna z innych miejsc.
  - nowe miejsce i nieznany sezon (`season`): dla każdego sezonu S i 3 foldów skupisk trening bez sezonu S
    i bez skupisk foldu, test na sezonie S w skupiskach foldu. To sytuacja przyszłego sezonu.
Punkty odniesienia: ΔNDMI = 0, model sezonowy (dzień roku + ostatnie NDMI, ten sam algorytm i podział),
16 cech pierwszego modelu (ten sam podział) oraz, jeśli podano KOWR_ML_PREVIOUS_MODEL, poprzedni plik modelu
oceniony na skupiskach, których nie było w jego treningu.
Przedział 10–90%: regresja kwantylowa i poprawka conformal (Romano i in. 2019) liczona osobno dla dolnej
i górnej granicy; pokrycie podajemy z poprawką wyznaczoną bez ocenianego foldu.
Model do aplikacji: te same hiperparametry, dopasowanie na wszystkich danych.
Hiperparametry i zestaw cech wybrano w osobnych eksperymentach na tych samych podziałach (opis w README).

Wynik: runs/<data>_<hash>/ z model.joblib, model_card.json, metrics.json, oof_predictions.parquet.
Użycie: python -m kowr_ml.pipeline.ndmi.train
"""
from __future__ import annotations

import hashlib
import json
import os
import platform
from datetime import UTC, datetime
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import sklearn
from sklearn.ensemble import HistGradientBoostingRegressor

from kowr_ml.pipeline import config as C
from kowr_ml.runtime.features import BASE_FEATURES, FEATURES, SEASONAL_FEATURES

PARAMS = {"learning_rate": 0.1, "max_iter": 700, "max_leaf_nodes": 31, "min_samples_leaf": 50, "l2_regularization": 1.0}
BIG_DROP = -0.05
QUANTILES = (0.1, 0.9)
DRY_DEPLETION = 0.75       # wyczerpanie bilansu referencyjnego uznawane za suszę (frakcja TAW)
VERY_DRY_CWB_MM = -100.0   # klimatyczny bilans wodny z 30 dni uznawany za głęboką suszę
PREVIOUS_MODEL_ENV = "KOWR_ML_PREVIOUS_MODEL"


def make_model(loss: str = "absolute_error", quantile: float | None = None, **overrides) -> HistGradientBoostingRegressor:
    kw = dict(loss=loss, early_stopping=True, validation_fraction=0.15, n_iter_no_change=30,
              random_state=C.RANDOM_SEED, **{**PARAMS, **overrides})
    if quantile is not None:
        kw["quantile"] = quantile
    return HistGradientBoostingRegressor(**kw)


def fold_of(cluster: str, k: int) -> int:
    """Stały przydział skupiska do foldu, zależny tylko od nazwy."""
    return int(hashlib.sha1(cluster.encode()).hexdigest(), 16) % k


def mae(y, p) -> float:
    return float(np.mean(np.abs(np.asarray(y) - np.asarray(p))))


def oof_spatial(df: pd.DataFrame, features: list[str], loss: str = "absolute_error", quantile: float | None = None) -> np.ndarray:
    """Prognozy spoza foldu: 5 foldów po skupisku, wszystkie sezony w treningu."""
    X, y = df[features].to_numpy(float), df["ndmi_delta"].to_numpy(float)
    fold = df["spatial_group"].map(lambda c: fold_of(c, C.CV_FOLDS)).to_numpy()
    pred = np.full(len(y), np.nan)
    for k in range(C.CV_FOLDS):
        te = fold == k
        if te.any():
            pred[te] = make_model(loss, quantile).fit(X[~te], y[~te]).predict(X[te])
    return pred


def oof_season(df: pd.DataFrame, features: list[str]) -> np.ndarray:
    """Prognozy dla sezonu i skupisk, których dopasowanie nie widziało."""
    X, y = df[features].to_numpy(float), df["ndmi_delta"].to_numpy(float)
    season = df["season"].to_numpy()
    fold = df["spatial_group"].map(lambda c: fold_of(c, C.SEASON_CV_FOLDS)).to_numpy()
    pred = np.full(len(y), np.nan)
    for s in np.unique(season):
        for k in range(C.SEASON_CV_FOLDS):
            te, tr = (season == s) & (fold == k), (season != s) & (fold != k)
            if te.any() and tr.any():
                pred[te] = make_model().fit(X[tr], y[tr]).predict(X[te])
    return pred


def interval_adjustments(y: np.ndarray, lo: np.ndarray, hi: np.ndarray) -> tuple[float, float]:
    """O ile obniżyć dolną i podnieść górną granicę, żeby poniżej i powyżej zostało po 10% obserwacji."""
    level = min(1.0, np.ceil((len(y) + 1) * QUANTILES[1]) / len(y))
    return float(np.quantile(lo - y, level)), float(np.quantile(y - hi, level))


def calibrated_interval(df: pd.DataFrame, lo: np.ndarray, hi: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Przedział z poprawką wyznaczoną na pozostałych foldach (uczciwe pokrycie)."""
    y = df["ndmi_delta"].to_numpy(float)
    fold = df["spatial_group"].map(lambda c: fold_of(c, C.CV_FOLDS)).to_numpy()
    lo, hi = np.minimum(lo, hi), np.maximum(lo, hi)
    out_lo, out_hi = lo.copy(), hi.copy()
    for k in range(C.CV_FOLDS):
        te = fold == k
        if te.any():
            a_lo, a_hi = interval_adjustments(y[~te], lo[~te], hi[~te])
            out_lo[te], out_hi[te] = lo[te] - a_lo, hi[te] + a_hi
    return out_lo, out_hi


def metrics_block(df: pd.DataFrame, preds: dict[str, np.ndarray], interval: tuple[np.ndarray, np.ndarray] | None = None) -> dict:
    """MAE po wierszach: łącznie, w suszy, dla dużych spadków, według sezonu i miesiąca."""
    y = df["ndmi_delta"].to_numpy(float)
    out = {"rows": int(len(df)), "fields": int(df["field_id"].nunique()), "clusters": int(df["spatial_group"].nunique())}
    month = pd.to_datetime(df["issue_date"]).dt.month.to_numpy()
    season = df["season"].to_numpy()
    big = y <= BIG_DROP
    dry = df["ref_depletion_frac"].to_numpy() >= DRY_DEPLETION
    very_dry = df["cwb_mm_30d"].to_numpy() <= VERY_DRY_CWB_MM
    out.update(big_drop_rows=int(big.sum()), dry_rows=int(dry.sum()), very_dry_rows=int(very_dry.sum()))
    for name, p in preds.items():
        ok = np.isfinite(p)
        err = np.abs(y - p)
        out[name] = {
            "mae": float(err[ok].mean()),
            "bias": float((p - y)[ok].mean()),
            "mae_big_drop": float(err[ok & big].mean()),
            "mae_dry": float(err[ok & dry].mean()),
            "mae_very_dry": float(err[ok & very_dry].mean()),
            "mae_by_season": {int(s): float(err[ok & (season == s)].mean()) for s in np.unique(season[ok])},
            "mae_by_month": {int(m): float(err[ok & (month == m)].mean()) for m in np.unique(month[ok])},
        }
    if interval is not None:
        lo, hi = interval
        inside = (y >= lo) & (y <= hi)
        out["interval_80"] = {"coverage": float(inside.mean()), "below": float((y < lo).mean()), "above": float((y > hi).mean()),
                              "mean_width": float((hi - lo).mean()), "coverage_dry": float(inside[dry].mean()),
                              "coverage_by_season": {int(s): float(inside[season == s].mean()) for s in np.unique(season)}}
    return out


def fit_set(df: pd.DataFrame) -> dict:
    X, y = df[FEATURES].to_numpy(float), df["ndmi_delta"].to_numpy(float)
    return {"median": make_model().fit(X, y),
            "p10": make_model("quantile", QUANTILES[0]).fit(X, y),
            "p90": make_model("quantile", QUANTILES[1]).fit(X, y)}


def previous_model_block(df: pd.DataFrame, new_pred: np.ndarray) -> dict | None:
    """Poprzedni plik modelu i nowy model na tych samych wierszach: skupiska spoza treningu poprzedniego."""
    path = os.environ.get(PREVIOUS_MODEL_ENV)
    if not path:
        return None
    prev = joblib.load(Path(path) / "model.joblib")
    card = json.loads((Path(path) / "model_card.json").read_text(encoding="utf-8"))
    unseen = ~df["spatial_group"].isin(card["clusters"]).to_numpy()
    part = df[unseen]
    p_prev = prev["median"].predict(part[prev["features"]].to_numpy(float))
    block = metrics_block(part, {"zero": np.zeros(len(part)), "previous": p_prev, "new_out_of_fold": new_pred[unseen]})
    block["previous_run"] = card.get("run_id")
    block["previous_seasons"] = card.get("seasons")
    return block


def main() -> None:
    df = pd.read_parquet(C.DATA_DIR / "training.parquet").reset_index(drop=True)
    y = df["ndmi_delta"].to_numpy(float)
    print(f"wierszy {len(df)}, pól {df['field_id'].nunique()}, skupisk {df['spatial_group'].nunique()}, cech {len(FEATURES)}", flush=True)

    zero = np.zeros(len(df))
    spatial = {"zero": zero, "seasonal": oof_spatial(df, SEASONAL_FEATURES), "base16": oof_spatial(df, BASE_FEATURES),
               "hgb": oof_spatial(df, FEATURES)}
    print("nowe miejsce: " + ", ".join(f"{k} {mae(y, v):.4f}" for k, v in spatial.items()), flush=True)
    lo, hi = oof_spatial(df, FEATURES, "quantile", QUANTILES[0]), oof_spatial(df, FEATURES, "quantile", QUANTILES[1])
    cal_lo, cal_hi = calibrated_interval(df, np.minimum(lo, spatial["hgb"]), np.maximum(hi, spatial["hgb"]))
    season = {"zero": zero, "seasonal": oof_season(df, SEASONAL_FEATURES), "base16": oof_season(df, BASE_FEATURES),
              "hgb": oof_season(df, FEATURES)}
    print("nowe miejsce i sezon: " + ", ".join(f"{k} {mae(y, v):.4f}" for k, v in season.items()), flush=True)

    metrics = {"new_place": metrics_block(df, spatial, (cal_lo, cal_hi)), "new_place_and_season": metrics_block(df, season)}
    raw = (np.minimum(lo, spatial["hgb"]), np.maximum(hi, spatial["hgb"]))
    metrics["new_place"]["interval_80_before_adjustment"] = {
        "coverage": float(((y >= raw[0]) & (y <= raw[1])).mean()), "below": float((y < raw[0]).mean()), "above": float((y > raw[1]).mean())}
    previous = previous_model_block(df, spatial["hgb"])
    if previous:
        metrics["previous_model_on_clusters_it_never_saw"] = previous

    # Model do aplikacji: wszystkie dane. Poprawki przedziału z prognoz spoza foldu.
    final = fit_set(df)
    adjust_low, adjust_high = interval_adjustments(y, raw[0], raw[1])
    run_id = datetime.now(UTC).strftime("%Y%m%d_%H%M") + "_" + hashlib.sha1(
        json.dumps({"params": PARAMS, "features": FEATURES}, sort_keys=True).encode()).hexdigest()[:6]
    run = C.RUNS_DIR / run_id
    run.mkdir(parents=True, exist_ok=True)
    joblib.dump({**final, "features": FEATURES, "interval_adjust_low": adjust_low, "interval_adjust_high": adjust_high},
                run / "model.joblib", compress=3)
    oof = df[["field_id", "season", "issue_date", "spatial_group", "ndmi_last", "ndmi_delta"]].copy()
    oof = oof.assign(pred_new_place=spatial["hgb"], p10=cal_lo, p90=cal_hi, pred_new_place_and_season=season["hgb"],
                     pred_seasonal=spatial["seasonal"], pred_base16=spatial["base16"])
    oof.to_parquet(run / "oof_predictions.parquet", index=False)
    (run / "metrics.json").write_text(json.dumps({"params": PARAMS, **metrics}, indent=2), encoding="utf-8")
    stats = json.loads((C.DATA_DIR / "dataset_stats.json").read_text())
    m_sp, m_se = metrics["new_place"], metrics["new_place_and_season"]
    qualifies = m_sp["hgb"]["mae"] < m_sp["zero"]["mae"] and m_se["hgb"]["mae"] < m_se["zero"]["mae"]
    card = {
        "name": "kowr_ndmi_delta_7_14d",
        "run_id": run_id,
        "status": ("eksperymentalny" if qualifies else "niezakwalifikowany: nie bije prognozy ΔNDMI = 0"),
        "target": "ndmi_future - ndmi_last; ndmi_future = pierwsza zaakceptowana scena w t+7..t+14, "
                  "ndmi_last = ostatnia zaakceptowana scena w t-14..t-1",
        "features": FEATURES,
        "quantiles": list(QUANTILES),
        "interval_adjust_low": adjust_low,
        "interval_adjust_high": adjust_high,
        "hyperparameters": PARAMS,
        "train_rows_final_model": int(len(df)),
        "fields": int(df["field_id"].nunique()),
        "seasons": sorted(int(s) for s in df["season"].unique()),
        "clusters": sorted(df["spatial_group"].unique()),
        "dataset_stats": stats,
        "metrics": {
            "new_place": {k: m_sp[k]["mae"] for k in spatial} | {"interval_80_coverage": m_sp["interval_80"]["coverage"]},
            "new_place_and_season": {k: m_se[k]["mae"] for k in season},
        },
        "thresholds": {"min_pixels": C.MIN_PIXELS, "min_coverage": C.MIN_COVERAGE, "scl": C.SCL_VEGETATION},
        "data": {
            "fields": f"ESA WorldCover 10 m 2021 v200, klasa {C.WORLDCOVER_CROPLAND}, kwadraty {C.FIELD_SIZE_M} m "
                      "(CC BY 4.0, © ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) "
                      "processed by ESA WorldCover consortium)",
            "sentinel2": f"{', '.join(C.S2_COLLECTIONS)} przez {C.STAC_URL} (Sentinel Data Legal Notice)",
            "weather": "Open-Meteo Historical Weather API, domyślny model, timezone Europe/Warsaw (dane CC BY 4.0)",
        },
        "versions": {"python": platform.python_version(), "scikit-learn": sklearn.__version__,
                     "numpy": np.__version__, "pandas": pd.__version__},
        "limits": [
            "Pola to fragmenty gruntów ornych z WorldCover 2021, nie granice deklarowanych upraw; typ uprawy nieznany.",
            "Pogoda z jednej komórki na skupisko; brak prognozy pogody na okno 7–14 dni.",
            "Model prognozuje zmianę wskaźnika satelitarnego, nie wilgotność gleby ani dawkę nawodnienia.",
            "Zbiór nadreprezentuje okresy z dobrą widocznością roślinności (próg chmur i SCL).",
            "Sezon 2017 jest niepełny, a część punktów siatki ma pogodę tylko dla sezonów 2025–2026 (limit Open-Meteo).",
        ],
    }
    (run / "model_card.json").write_text(json.dumps(card, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(card["metrics"], indent=2))
    print(f"zapisano {run}")


if __name__ == "__main__":
    main()
