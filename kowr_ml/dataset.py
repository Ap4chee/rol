"""Tabela treningowa (spec. sekcja 4): wiersz na (pole, dzień prognozy) z cechami, etykietą i metadanymi.

Wejście: fields.parquet, obs/*.parquet, weather.parquet. Wynik: training.parquet i dataset_stats.json
(liczby wierszy odrzuconych z każdego powodu).
"""
from __future__ import annotations

import json
from datetime import date

import numpy as np
import pandas as pd

from . import config as C
from .features import FEATURES, WeatherSeries, feature_row, issue_dates, target


def load_obs() -> pd.DataFrame:
    files = sorted((C.DATA_DIR / "obs").glob("*_[0-9][0-9][0-9][0-9].parquet"))
    df = pd.concat([pd.read_parquet(f) for f in files], ignore_index=True)
    df = df[df["ndmi"].notna()].copy()
    df["valid_fraction"] = df["valid_px"] / df["total_px"]
    # Kilka scen z jednego dnia (nakładanie orbit/kafli): bierzemy tę z najlepszym pokryciem pola.
    df = df.sort_values(["field_id", "date", "valid_fraction"]).drop_duplicates(["field_id", "date"], keep="last")
    return df


def weather_by_cluster() -> dict[str, WeatherSeries]:
    w = pd.read_parquet(C.DATA_DIR / "weather.parquet")
    out = {}
    for cluster, g in w.groupby("cluster"):
        g = g.sort_values("date")
        out[cluster] = WeatherSeries([date.fromisoformat(d) for d in g["date"]], g["rain_mm"], g["et0_mm"], g["tmax_c"])
    return out


def build() -> tuple[pd.DataFrame, dict]:
    fields = pd.read_parquet(C.DATA_DIR / "fields.parquet").set_index("field_id")
    obs = load_obs()
    weather = weather_by_cluster()
    stats = {"candidates": 0, "no_last_scene_or_weather": 0, "no_target_scene": 0, "rows": 0}
    rows = []
    for field_id, g in obs.groupby("field_id"):
        cluster = fields.at[field_id, "cluster"]
        g = g.sort_values("date")
        d = g["date"].to_numpy(dtype="datetime64[D]")
        nd = g["ndmi"].to_numpy(float)
        fr = g["valid_fraction"].to_numpy(float)
        sids = g["scene_id"].to_numpy()
        seasons = sorted({int(s[:4]) for s in g["date"]})
        for season in seasons:
            for t in issue_dates(season):
                stats["candidates"] += 1
                f = feature_row(d, nd, fr, weather[cluster], t)
                if f is None:
                    stats["no_last_scene_or_weather"] += 1
                    continue
                y = target(d, nd, fr, t)
                if y is None:
                    stats["no_target_scene"] += 1
                    continue
                k, j = f.pop("_last_index"), y.pop("target_index")
                rows.append({"field_id": field_id, "season": season, "issue_date": t.isoformat(),
                             "spatial_group": cluster, "weather_cell_id": cluster, **f, **y,
                             "ndmi_delta": y["ndmi_future"] - f["ndmi_last"],
                             "last_scene_id": sids[k], "last_scene_date": str(d[k]),
                             "target_scene_id": sids[j], "target_scene_date": str(d[j])})
    df = pd.DataFrame(rows)
    stats["rows"] = len(df)
    stats["fields"] = int(df["field_id"].nunique()) if len(df) else 0
    stats["rows_by_season"] = df.groupby("season").size().to_dict() if len(df) else {}
    return df, stats


def main() -> None:
    df, stats = build()
    df.to_parquet(C.DATA_DIR / "training.parquet", index=False)
    (C.DATA_DIR / "dataset_stats.json").write_text(json.dumps(stats, indent=2, default=str))
    print(json.dumps(stats, indent=2, default=str))
    print(df[FEATURES + ["ndmi_delta"]].describe().T.to_string())


if __name__ == "__main__":
    main()
