"""Tabela treningowa (spec. sekcja 4): wiersz na (pole, dzień prognozy) z cechami, etykietą i metadanymi.

Wejście: fields.parquet, obs/*.parquet, weather.parquet. Wynik: training.parquet i dataset_stats.json
(liczby wierszy odrzuconych z każdego powodu). Skupiska liczone równolegle.

Użycie: python -m kowr_ml.pipeline.ndmi.dataset [procesy]
"""
from __future__ import annotations

import json
import sys
from concurrent.futures import ProcessPoolExecutor

import pandas as pd

from kowr_ml.pipeline import config as C
from kowr_ml.pipeline.ndmi.labels import issue_dates, target
from kowr_ml.pipeline.tables import weather_series
from kowr_ml.runtime.features import FEATURES, FieldScenes, feature_row

STAT_KEYS = ("candidates", "no_last_scene_or_weather", "no_target_scene", "rows")


def field_scenes(g: pd.DataFrame) -> FieldScenes:
    """Sceny pola z wierszy obs/*.parquet (s2.py)."""
    return FieldScenes.from_columns(
        g["date"].to_numpy(dtype="datetime64[D]"), g["total_px"], g["n_veg"], g["n_bare"], g["n_cloud"],
        g["valid_px"] / g["total_px"], g["ndmi"], g["ndvi"], g["nir_med"], g["swir_med"], g["red_med"])


def build_cluster(args: tuple[str, pd.DataFrame | None]) -> tuple[list[dict], dict]:
    cluster, wframe = args
    stats = dict.fromkeys(STAT_KEYS, 0)
    files = sorted((C.DATA_DIR / "obs").glob(f"{cluster}_[0-9][0-9][0-9][0-9].parquet"))
    if not files or wframe is None:
        return [], stats
    obs = pd.concat([pd.read_parquet(f) for f in files], ignore_index=True)
    fields = pd.read_parquet(C.DATA_DIR / "fields.parquet")
    fields = fields[fields["cluster"] == cluster].set_index("field_id")
    weather = weather_series(wframe)
    rows = []
    for field_id, g in obs.groupby("field_id"):
        s = field_scenes(g)
        if s.accepted.size == 0:
            continue
        scene_ids = dict(zip(g["date"].to_numpy(dtype="datetime64[D]"), g["scene_id"]))  # do metadanych wiersza
        lat, lon = float(fields.at[field_id, "lat"]), float(fields.at[field_id, "lon"])
        for season in sorted({int(str(d)[:4]) for d in s.dates[s.accepted]}):
            for t in issue_dates(season):
                stats["candidates"] += 1
                f = feature_row(s, weather, t, lat, lon)
                if f is None:
                    stats["no_last_scene_or_weather"] += 1
                    continue
                y = target(s, t)
                if y is None:
                    stats["no_target_scene"] += 1
                    continue
                k, j = f.pop("_last_index"), y.pop("target_index")
                rows.append({"field_id": field_id, "season": season, "issue_date": t.isoformat(),
                             "spatial_group": cluster, "weather_cell_id": cluster, **f, **y,
                             "ndmi_delta": y["ndmi_future"] - f["ndmi_last"],
                             "last_scene_date": str(s.dates[k]), "target_scene_date": str(s.dates[j]),
                             "last_scene_id": scene_ids.get(s.dates[k]), "target_scene_id": scene_ids.get(s.dates[j])})
    stats["rows"] = len(rows)
    return rows, stats


def build(processes: int = 8) -> tuple[pd.DataFrame, dict]:
    weather = {c: g for c, g in pd.read_parquet(C.DATA_DIR / "weather.parquet").groupby("cluster")}
    jobs = [(name, weather.get(name)) for name, _, _ in C.CLUSTERS]
    rows, stats = [], dict.fromkeys(STAT_KEYS, 0)
    with ProcessPoolExecutor(processes) as pool:
        for r, s in pool.map(build_cluster, jobs, chunksize=1):
            rows.extend(r)
            for key in STAT_KEYS:
                stats[key] += s[key]
    df = pd.DataFrame(rows)
    stats["fields"] = int(df["field_id"].nunique()) if len(df) else 0
    stats["clusters"] = int(df["spatial_group"].nunique()) if len(df) else 0
    stats["clusters_without_weather"] = sorted(name for name, w in jobs if w is None)
    stats["rows_by_season"] = {int(k): int(v) for k, v in df.groupby("season").size().items()} if len(df) else {}
    return df, stats


def main(argv: list[str]) -> None:
    df, stats = build(int(argv[0]) if argv else 8)
    df.to_parquet(C.DATA_DIR / "training.parquet", index=False)
    (C.DATA_DIR / "dataset_stats.json").write_text(json.dumps(stats, indent=2, default=str))
    print(json.dumps(stats, indent=2, default=str))
    print(df[FEATURES + ["ndmi_delta"]].describe().T.to_string())


if __name__ == "__main__":
    main(sys.argv[1:])
