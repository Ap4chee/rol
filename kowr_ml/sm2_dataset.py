"""Tabela treningowa modelu wilgotności v2: wiersze v1 (sm_dataset.py) + prognoza ECMWF IFS + gleba i teren.

Model v1 zostaje bez zmian. v2 dostaje dodatkowo:
  prognozę wydaną w dniu t (ifs.py, przebieg 00 UTC): opad i temperaturę 2 m dla dni t … t+k,
    wilgotność 0–100 cm z analizy IFS na dzień t i prognozowaną przez IFS zmianę do dnia t+k,
  cechy stałe skupiska (static.py): uziarnienie i węgiel 0–30 cm, FC i WP 0–100 cm, spadek i wysokość terenu.
Archiwum prognoz zaczyna się 18.01.2023, więc zbiór v2 obejmuje tylko dni prognozy od tej daty.
Do 01.2024 IFS w archiwum nie ma wilgotności gleby: te cechy są wtedy puste (NaN), HistGradientBoosting to obsługuje.
Wynik: training_sm2.parquet.
"""
from __future__ import annotations

from . import config as C
from .sm_dataset import SM_FEATURES, SM_LAG_DAYS
from .static import STATIC_FEATURES

FC_FEATURES = ["fc_rain_mm_to_k", "fc_rain_mm_7d", "fc_t2m_mean_to_k", "ifs_sm_analysis", "ifs_sm_change_to_k"]
SM2_FEATURES = SM_FEATURES + FC_FEATURES + STATIC_FEATURES


def forecast_features(fc):
    """Z tabeli ifs_forecast (wiersz na skupisko, dzień t, dzień prognozy k) cechy skumulowane do dnia t+k."""
    fc = fc.sort_values(["cluster", "issue_date", "lead"]).copy()
    g = fc.groupby(["cluster", "issue_date"])
    fc["fc_rain_mm_to_k"] = g["rain_mm"].cumsum()
    # suma pierwszych 7 dni (t … t+6) niezależnie od horyzontu; NaN, gdy brak któregoś z tych dni
    fc["fc_rain_mm_7d"] = fc["rain_mm"].where(fc["lead"] < 7).groupby([fc["cluster"], fc["issue_date"]]).transform(
        "sum", min_count=7)
    fc["fc_t2m_mean_to_k"] = g["t2m_c"].cumsum() / (fc["lead"] + 1)
    fc["ifs_sm_analysis"] = fc["sm_analysis"]
    fc["ifs_sm_change_to_k"] = fc["sm_0_100cm"] - fc["sm_analysis"]
    return fc[["cluster", "issue_date", "lead", "grid"] + FC_FEATURES]


def build():
    import pandas as pd

    v1 = pd.read_parquet(C.DATA_DIR / "training_sm.parquet")
    fc = forecast_features(pd.read_parquet(C.DATA_DIR / "ifs_forecast.parquet"))
    static = pd.read_parquet(C.DATA_DIR / "cluster_static.parquet")[["cluster"] + STATIC_FEATURES]
    v1["lead"] = v1["lead_days"] - SM_LAG_DAYS
    df = v1.merge(fc, left_on=["spatial_group", "issue_date", "lead"], right_on=["cluster", "issue_date", "lead"])
    df = df[df["fc_rain_mm_to_k"].notna()].drop(columns="cluster").merge(
        static, left_on="spatial_group", right_on="cluster").drop(columns=["cluster", "lead"])
    stats = {"v1_rows_since_archive": int((v1["issue_date"] >= fc["issue_date"].min()).sum()), "rows": len(df),
             "rows_by_season": df.groupby("season").size().to_dict(),
             "rows_with_ifs_soil_moisture": int(df["ifs_sm_analysis"].notna().sum())}
    return df, stats


def main() -> None:
    import json

    df, stats = build()
    df.to_parquet(C.DATA_DIR / "training_sm2.parquet", index=False)
    (C.DATA_DIR / "dataset_sm2_stats.json").write_text(json.dumps(stats, indent=2, default=str))
    print(json.dumps(stats, indent=2, default=str))
    print(df[FC_FEATURES + STATIC_FEATURES].describe().T.round(3).to_string())


if __name__ == "__main__":
    main()
