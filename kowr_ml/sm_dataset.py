"""Tabela treningowa modelu prognozy wilgotności gleby 0–100 cm (ERA5-Land) na dni t … t+13.

Etykieta: sm_delta = θ(t+k) − θ(t − SM_LAG_DAYS) [m3/m3], k = 0…13, θ = dobowa średnia wilgotność 0–100 cm
(średnia warstw 0–7, 7–28 i 28–100 cm ważona grubością). Dni t … t+13 to te same dni co linia prognozy
na wykresie zapasu wody. ERA5-Land ma ok. 5 dni opóźnienia, dlatego ostatnia znana wilgotność to dzień t−6,
tak samo w treningu i przy predykcji. Pogoda tylko do t−1 (spec. sekcja 4: bez faktycznej pogody z dni ≥ t).
Wejście: era5_land_sm.parquet i era5_weather.parquet (eksport plików Open-Meteo z s3://openmeteo, poza repo).
Wynik: training_sm.parquet i dataset_sm_stats.json. Wiersz = (skupisko, dzień prognozy t, dzień docelowy t+k).
"""
from __future__ import annotations

import json
from datetime import date, timedelta

import numpy as np

from . import config as C
from .features import WeatherSeries, doy_features

SM_SEASONS = range(2019, 2026)
SM_LAG_DAYS = 6           # ostatnia wilgotność z ERA5-Land: dzień t−6
HORIZON_DAYS = range(14)  # dzień docelowy t+k; 14 dni, bo tyle dni pełnej prognozy IFS daje Open-Meteo
ISSUE_STEP_DAYS = 3       # sąsiednie dni prognozy niosą prawie tę samą informację
BIG_DRY = -0.02           # duże przesuszenie w metrykach: spadek θ o ≥ 0,02 m3/m3

SM_FEATURES = [
    "sm_last", "sm_top_last", "sm_change_7d", "lead_days", "rain_mm_gap", "et0_mm_gap",
    "day_of_year_sin", "day_of_year_cos",
    "rain_mm_7d", "rain_mm_14d", "rain_mm_30d", "et0_mm_7d", "et0_mm_14d", "et0_mm_30d",
    "cwb_mm_30d", "tmax_c_mean_7d", "ref_depletion_frac", "days_since_rain_5mm",
]
SM_SEASONAL_FEATURES = ["day_of_year_sin", "day_of_year_cos", "sm_last", "lead_days"]


def sm_feature_row(sm_start: date, sm_root: np.ndarray, sm_top: np.ndarray, weather: WeatherSeries, t: date) -> dict | None:
    """Cechy dla dnia prognozy t albo None, gdy brakuje wilgotności z t−6 i t−13 lub pogody do t−1.

    sm_root, sm_top – dobowe θ 0–100 cm i 0–7 cm [m3/m3] od dnia sm_start, bez przerw w datach (braki jako NaN).
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


def build():
    import pandas as pd  # tylko trening; funkcja cech wyżej działa bez pandas (jak w aplikacji)

    from .dataset import weather_by_cluster

    sm = pd.read_parquet(C.DATA_DIR / "era5_land_sm.parquet")
    weather = weather_by_cluster("era5_weather.parquet")
    stats = {"candidates": 0, "no_features": 0, "no_target": 0, "rows": 0}
    rows = []
    for cluster, g in sm.groupby("cluster"):
        g = g.sort_values("date")
        start = date.fromisoformat(g["date"].iloc[0])
        assert (date.fromisoformat(g["date"].iloc[-1]) - start).days == len(g) - 1, f"{cluster}: przerwy w datach"
        root, top = g["sm_0_100cm"].to_numpy(float), g["sm_0_7cm"].to_numpy(float)
        t = date(min(SM_SEASONS), 1, 1)
        while t.year <= max(SM_SEASONS):
            stats["candidates"] += 1
            f = sm_feature_row(start, root, top, weather[cluster], t)
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
    df = pd.DataFrame(rows)
    stats["rows"] = len(df)
    stats["rows_by_season"] = df.groupby("season").size().to_dict() if len(df) else {}
    return df, stats


def main() -> None:
    df, stats = build()
    df.to_parquet(C.DATA_DIR / "training_sm.parquet", index=False)
    (C.DATA_DIR / "dataset_sm_stats.json").write_text(json.dumps(stats, indent=2, default=str))
    print(json.dumps(stats, indent=2, default=str))
    print(df[SM_FEATURES + ["sm_delta"]].describe().T.to_string())


if __name__ == "__main__":
    main()
