"""Tabela treningowa modelu wilgotności v3: jak v2, ale bez ERA5-Land w cechach (v1 i v2 bez zmian).

Powód: w aplikacji ERA5-Land jest tylko w archiwum Open-Meteo, które z sieci hackathonu zwraca 429, a v2 potrzebuje
θ z ERA5-Land z dnia t−6 przy każdej predykcji. v3 bierze stan gleby z analizy IFS, którą daje działające API prognoz.
Etykieta: θ(t+k) − θ(t−1) [m3/m3] z ERA5-Land, k = 0…13, czyli zmiana od ostatniej doby bilansu działki
(aplikacja doczepia prognozę do zapasu z t−1 bez przesunięcia). Wiersze i pozostałe cechy z training_sm2.parquet.
Wynik: training_sm3.parquet.
"""
from __future__ import annotations

import json
from datetime import date, timedelta

from . import config as C
from .sm2_dataset import FC_FEATURES
from .static import STATIC_FEATURES

WEATHER_FEATURES = ["rain_mm_7d", "rain_mm_14d", "rain_mm_30d", "et0_mm_7d", "et0_mm_14d", "et0_mm_30d",
                    "cwb_mm_30d", "tmax_c_mean_7d", "ref_depletion_frac", "days_since_rain_5mm"]
SOIL_FEATURES = [f for f in STATIC_FEATURES if f.startswith("soil_")]   # teren pominięty na życzenie
SM3_FEATURES = ["horizon_days", "day_of_year_sin", "day_of_year_cos"] + WEATHER_FEATURES + FC_FEATURES + SOIL_FEATURES
SM3_SEASONAL_FEATURES = ["day_of_year_sin", "day_of_year_cos", "horizon_days"]


def build():
    import pandas as pd

    df = pd.read_parquet(C.DATA_DIR / "training_sm2.parquet")
    sm = pd.read_parquet(C.DATA_DIR / "era5_land_sm.parquet")[["cluster", "date", "sm_0_100cm"]]
    sm = sm.rename(columns={"cluster": "spatial_group", "sm_0_100cm": "sm_yesterday"})
    df["date"] = [(date.fromisoformat(t) - timedelta(days=1)).isoformat() for t in df["issue_date"]]
    df = df.merge(sm, on=["spatial_group", "date"]).drop(columns="date")
    df["horizon_days"] = (pd.to_datetime(df["target_date"]) - pd.to_datetime(df["issue_date"])).dt.days
    df["sm3_delta"] = df["sm_target"] - df["sm_yesterday"]
    df = df[df["sm3_delta"].notna()]
    return df, {"rows": len(df), "rows_by_season": df.groupby("season").size().to_dict()}


def main() -> None:
    df, stats = build()
    df.to_parquet(C.DATA_DIR / "training_sm3.parquet", index=False)
    (C.DATA_DIR / "dataset_sm3_stats.json").write_text(json.dumps(stats, indent=2, default=str))
    print(json.dumps(stats, indent=2, default=str))
    print(df[["horizon_days", "sm3_delta"]].describe().T.round(4).to_string())


if __name__ == "__main__":
    main()
