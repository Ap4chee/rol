"""Tabela treningowa modelu wilgotności gleby (wersja v3, wdrożona) -> training_sm3.parquet, dataset_sm3_stats.json.

Etykieta: θ(t+k) − θ(t−1) [m3/m3] z ERA5-Land, k = 0…13, θ = dobowa średnia wilgotność 0–100 cm (warstwy 0–7, 7–28
i 28–100 cm ważone grubością). To zmiana od ostatniej doby bilansu działki: aplikacja doczepia prognozę do zapasu
z t−1 bez przesunięcia. Dni t … t+13 to te same dni co linia prognozy na wykresie zapasu wody.
Cechy (bez ERA5-Land, którego aplikacja nie dostaje): pogoda do t−1 (spec. sekcja 4: bez faktycznej pogody z dni ≥ t),
prognoza ECMWF IFS wydana w dniu t (ifs.py), gleba skupiska (static.py), dzień roku i dzień prognozy k.
Archiwum IFS zaczyna się 18.01.2023, a do 01.2024 nie ma wilgotności gleby (wtedy NaN; HistGradientBoosting to obsługuje).

Wiersze są te same, na których uczono wdrożony model: dzień prognozy t musi mieć też θ z ERA5-Land z t−6 i t−13
(sm_feature_row), bo tak filtrowała tabela pierwszej wersji, z której v3 powstał. Bez tego filtra liczby z karty
modelu nie dałyby się odtworzyć. Wersje v1 i v2 (z θ z t−6 w cechach) są opisane w README, kod jest w historii gita.
Wejście: era5_land_sm.parquet i era5_weather.parquet (eksport plików Open-Meteo z s3://openmeteo, poza repo),
ifs_forecast.parquet, cluster_static.parquet. Wiersz = (skupisko, dzień prognozy t, dzień docelowy t+k).
"""
from __future__ import annotations

import json
from datetime import date, timedelta

import numpy as np

from kowr_ml.pipeline import config as C
from kowr_ml.pipeline.soil_moisture.static import STATIC_FEATURES
from kowr_ml.runtime.features import WeatherSeries, doy_features
from kowr_ml.runtime.soil_moisture import SOIL_FEATURES

SM_SEASONS = range(2019, 2026)
SM_LAG_DAYS = 6           # ERA5-Land ma ok. 5 dni opóźnienia: ostatnia znana wilgotność to dzień t−6
HORIZON_DAYS = range(14)  # dzień docelowy t+k; 14 dni, bo tyle dni pełnej prognozy IFS daje Open-Meteo
ISSUE_STEP_DAYS = 3       # sąsiednie dni prognozy niosą prawie tę samą informację
BIG_DRY = -0.02           # duże przesuszenie w metrykach: spadek θ o ≥ 0,02 m3/m3

WEATHER_FEATURES = ["rain_mm_7d", "rain_mm_14d", "rain_mm_30d", "et0_mm_7d", "et0_mm_14d", "et0_mm_30d",
                    "cwb_mm_30d", "tmax_c_mean_7d", "ref_depletion_frac", "days_since_rain_5mm"]
FC_FEATURES = ["fc_rain_mm_to_k", "fc_rain_mm_7d", "fc_t2m_mean_to_k", "ifs_sm_analysis", "ifs_sm_change_to_k"]
CALENDAR_FEATURES = ["horizon_days", "day_of_year_sin", "day_of_year_cos"]
FEATURES = CALENDAR_FEATURES + WEATHER_FEATURES + FC_FEATURES + list(SOIL_FEATURES)   # teren pominięty na życzenie
SEASONAL_FEATURES = ["day_of_year_sin", "day_of_year_cos", "horizon_days"]   # kolejność jak przy treningu wdrożonego
TARGET = "sm3_delta"


def sm_feature_row(sm_start: date, sm_root: np.ndarray, sm_top: np.ndarray, weather: WeatherSeries, t: date) -> dict | None:
    """Cechy z θ i pogody dla dnia prognozy t albo None, gdy brakuje θ z t−6 i t−13 lub pogody do t−1.

    sm_root, sm_top – dobowe θ 0–100 cm i 0–7 cm [m3/m3] od dnia sm_start, bez przerw w datach (braki jako NaN).
    Kolumny z θ (sm_last, sm_change_7d…) zostają w tabeli do analizy; model v3 ich nie dostaje.
    """
    i = (t - sm_start).days - SM_LAG_DAYS
    if i - 7 < 0 or i >= len(sm_root):
        return None
    last, top, prev = float(sm_root[i]), float(sm_top[i]), float(sm_root[i - 7])
    if not np.isfinite([last, top, prev]).all():
        return None
    wf = weather.features(t)
    gap_rain = weather.window(weather.rain, t, SM_LAG_DAYS - 1)   # dni t−5 … t−1, po ostatniej wilgotności
    gap_et0 = weather.window(weather.et0, t, SM_LAG_DAYS - 1)
    if wf is None or gap_rain is None or gap_et0 is None:
        return None
    return {"sm_last": last, "sm_top_last": top, "sm_change_7d": last - prev,
            "rain_mm_gap": gap_rain, "et0_mm_gap": gap_et0, **wf, **doy_features(t)}


def cluster_rows(cluster: str, g, weather: WeatherSeries, stats: dict) -> list[dict]:
    """Wiersze (t, t+k) jednego skupiska z ERA5-Land; `g` to jego dobowe θ posortowane po dacie."""
    start = date.fromisoformat(g["date"].iloc[0])
    assert (date.fromisoformat(g["date"].iloc[-1]) - start).days == len(g) - 1, f"{cluster}: przerwy w datach"
    root, top = g["sm_0_100cm"].to_numpy(float), g["sm_0_7cm"].to_numpy(float)
    rows = []
    t = date(min(SM_SEASONS), 1, 1)
    while t.year <= max(SM_SEASONS):
        stats["candidates"] += 1
        f = sm_feature_row(start, root, top, weather, t)
        if f is None:
            stats["no_features"] += 1
        for k in HORIZON_DAYS if f is not None else ():
            j = (t - start).days + k
            if j >= len(root) or not np.isfinite(root[j]):
                stats["no_target"] += 1
                continue
            rows.append({"field_id": cluster, "season": t.year, "issue_date": t.isoformat(),
                         "target_date": (t + timedelta(days=k)).isoformat(), "spatial_group": cluster,
                         "weather_cell_id": cluster, "lead_days": SM_LAG_DAYS + k, **f,
                         "sm_target": float(root[j]), "sm_delta": float(root[j]) - f["sm_last"]})
        t += timedelta(days=ISSUE_STEP_DAYS)
    return rows


def forecast_features(fc):
    """Z tabeli ifs_forecast (wiersz na skupisko, dzień t, dzień prognozy k) cechy skumulowane do dnia t+k.

    Ta sama definicja co runtime/soil_moisture.ifs_features (aplikacja), tylko na całej tabeli naraz.
    """
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


def with_forecast_and_static(rows, fc, static):
    """Dołącza prognozę IFS z dnia t dla dnia t+k i cechy stałe skupiska; wiersze bez opadu prognozy odpadają."""
    rows = rows.assign(lead=rows["lead_days"] - SM_LAG_DAYS)
    df = rows.merge(fc, left_on=["spatial_group", "issue_date", "lead"], right_on=["cluster", "issue_date", "lead"])
    return df[df["fc_rain_mm_to_k"].notna()].drop(columns="cluster").merge(
        static, left_on="spatial_group", right_on="cluster").drop(columns=["cluster", "lead"])


def with_label(df, sm):
    """Etykieta v3: θ(t+k) − θ(t−1) z ERA5-Land skupiska."""
    import pandas as pd

    yesterday = sm[["cluster", "date", "sm_0_100cm"]].rename(columns={"cluster": "spatial_group", "sm_0_100cm": "sm_yesterday"})
    df = df.assign(date=[(date.fromisoformat(t) - timedelta(days=1)).isoformat() for t in df["issue_date"]])
    df = df.merge(yesterday, on=["spatial_group", "date"]).drop(columns="date")
    df["horizon_days"] = (pd.to_datetime(df["target_date"]) - pd.to_datetime(df["issue_date"])).dt.days
    df[TARGET] = df["sm_target"] - df["sm_yesterday"]
    return df[df[TARGET].notna()]


def build():
    import pandas as pd  # tylko trening; funkcje cech wyżej działają bez pandas (jak w aplikacji)

    from kowr_ml.pipeline.tables import weather_by_cluster

    sm = pd.read_parquet(C.DATA_DIR / "era5_land_sm.parquet")
    weather = weather_by_cluster("era5_weather.parquet")
    era5_stats = {"candidates": 0, "no_features": 0, "no_target": 0}
    rows = []
    for cluster, g in sm.groupby("cluster"):
        rows.extend(cluster_rows(cluster, g.sort_values("date"), weather[cluster], era5_stats))
    fc = forecast_features(pd.read_parquet(C.DATA_DIR / "ifs_forecast.parquet"))
    static = pd.read_parquet(C.DATA_DIR / "cluster_static.parquet")[["cluster"] + STATIC_FEATURES]
    df = with_label(with_forecast_and_static(pd.DataFrame(rows), fc, static), sm)
    stats = {"rows": len(df), "rows_by_season": df.groupby("season").size().to_dict(),
             "era5_rows": {**era5_stats, "rows": len(rows)}}
    return df, stats


def main() -> None:
    df, stats = build()
    df.to_parquet(C.DATA_DIR / "training_sm3.parquet", index=False)
    (C.DATA_DIR / "dataset_sm3_stats.json").write_text(json.dumps(stats, indent=2, default=str))
    print(json.dumps(stats, indent=2, default=str))
    print(df[["horizon_days", TARGET]].describe().T.round(4).to_string())


if __name__ == "__main__":
    main()
