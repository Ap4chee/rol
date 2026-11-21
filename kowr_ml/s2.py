"""Obserwacje NDMI pól z Sentinel-2 L2A (Earth Search), zgodnie ze specyfikacją, sekcja 3.

Pętla po scenach, nie po polach: dla każdej sceny czytamy jedno okno obejmujące całe skupisko,
najpierw SCL, a pasma B8A (nir08) i B11 (swir16) tylko gdy choć jedno pole przeszło próg.
Reguły: środek piksela w polu, SCL = 4, reflektancja = DN · scale + offset z `raster:bands`,
DN = 0 to NoData, odrzucamy niefinitywne i ujemne reflektancje oraz mianownik ≤ 1e-6,
próg ≥ 6 ważnych pikseli i ≥ 65% środków pikseli pola. Wartość pola to mediana NDMI.

Wynik: obs/<skupisko>_<rok>.parquet, wiersz na (pole, scena) dla pól, które scena obejmuje:
field_id, scene_id, date (doba Europe/Warsaw), total_px, valid_px, ndmi (NaN = obserwacja odrzucona).
"""
from __future__ import annotations

import sys
import time
import traceback
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd
from pyproj import Transformer
from shapely import wkt as shp_wkt
from shapely.geometry import box, mapping
from shapely.ops import transform as shp_transform

from . import config as C

WARSAW = ZoneInfo("Europe/Warsaw")
GDAL_OPTIONS = {
    "GDAL_DISABLE_READDIR_ON_OPEN": "EMPTY_DIR",
    "CPL_VSIL_CURL_ALLOWED_EXTENSIONS": ".tif",
    "GDAL_HTTP_MERGE_CONSECUTIVE_RANGES": "YES",
    "GDAL_HTTP_TIMEOUT": "60",
    "GDAL_HTTP_MAX_RETRY": "4",
    "GDAL_HTTP_RETRY_DELAY": "2",
    "VSI_CACHE": "TRUE",
}
WORKERS = 64


def scene_items(cluster_bbox_4326: tuple, season: int) -> list[dict]:
    from pystac_client import Client

    client = Client.open(C.STAC_URL)
    search = client.search(collections=[C.S2_COLLECTION], intersects=mapping(box(*cluster_bbox_4326)),
                           datetime=f"{season}-{C.S2_MONTHS[0]}/{season}-{C.S2_MONTHS[1]}", limit=200)
    out = []
    for item in search.items():
        try:
            def asset(key):
                a = item.assets[key]
                rb = (a.extra_fields.get("raster:bands") or [{}])[0]
                return {"href": a.href, "scale": rb.get("scale", 1.0), "offset": rb.get("offset", 0.0),
                        "nodata": rb.get("nodata", 0)}
            out.append({"id": item.id, "date": item.datetime.astimezone(WARSAW).date().isoformat(),
                        "scl": asset("scl"), "nir": asset("nir08"), "swir": asset("swir16")})
        except KeyError:
            continue
    return out


class ClusterGeometry:
    """Pola skupiska w układzie danej sceny; etykiety pikseli liczone raz na (układ, okno)."""

    def __init__(self, fields: pd.DataFrame):
        self.field_ids = fields["field_id"].tolist()
        self.polys = [shp_wkt.loads(w) for w in fields["wkt"]]
        minx = min(p.bounds[0] for p in self.polys); miny = min(p.bounds[1] for p in self.polys)
        maxx = max(p.bounds[2] for p in self.polys); maxy = max(p.bounds[3] for p in self.polys)
        self.bbox = (minx, miny, maxx, maxy)
        self._cache: dict = {}

    def labels(self, ds):
        from rasterio.features import rasterize
        from rasterio.windows import from_bounds

        crs = ds.crs.to_string()
        key = (crs, tuple(ds.transform)[:6])
        if key not in self._cache:
            tr = Transformer.from_crs("EPSG:4326", crs, always_xy=True)
            polys = [shp_transform(tr.transform, p) for p in self.polys]
            minx = min(p.bounds[0] for p in polys) - 40; miny = min(p.bounds[1] for p in polys) - 40
            maxx = max(p.bounds[2] for p in polys) + 40; maxy = max(p.bounds[3] for p in polys) + 40
            win = from_bounds(minx, miny, maxx, maxy, ds.transform).round_offsets().round_lengths()
            wt = ds.window_transform(win)
            lab = rasterize([(mapping(p), i + 1) for i, p in enumerate(polys)],
                            out_shape=(int(win.height), int(win.width)), transform=wt, fill=0,
                            all_touched=False, dtype="int32")
            self._cache[key] = (win, lab)
        return self._cache[key]


def _read(href: str, geom: ClusterGeometry):
    import rasterio
    with rasterio.open(href) as ds:
        win, lab = geom.labels(ds)
        arr = ds.read(1, window=win, boundless=True, fill_value=0)
    return arr, lab


def process_scene(scene: dict, geom: ClusterGeometry) -> list[dict]:
    import rasterio

    with rasterio.Env(**GDAL_OPTIONS):
        scl, lab = _read(scene["scl"]["href"], geom)
        n = len(geom.field_ids) + 1
        total = np.bincount(lab.ravel(), minlength=n)
        # Piksele poza zasięgiem danych sceny (SCL = 0, NoData) nie liczą się do pola: pole na skraju
        # kafla jest wtedy częściowo poza sceną i odrzucamy je, jeśli to, co zostaje, jest za małe.
        veg = scl == C.SCL_VEGETATION
        valid = np.bincount(lab[veg].ravel(), minlength=n)
        candidate = (valid >= C.MIN_PIXELS) & (valid >= C.MIN_COVERAGE * total) & (total >= C.MIN_PIXELS)
        candidate[0] = False
        ndmi_field = np.full(n, np.nan)
        valid_final = np.zeros(n, dtype=int)
        if candidate.any():
            nir, _ = _read(scene["nir"]["href"], geom)
            swir, _ = _read(scene["swir"]["href"], geom)
            if nir.shape != scl.shape or swir.shape != scl.shape:
                raise RuntimeError(f"niezgodna siatka pasm w {scene['id']}")
            ok = veg & (nir != scene["nir"]["nodata"]) & (swir != scene["swir"]["nodata"])
            rn = nir.astype("float64") * scene["nir"]["scale"] + scene["nir"]["offset"]
            rs = swir.astype("float64") * scene["swir"]["scale"] + scene["swir"]["offset"]
            den = rn + rs
            ok &= np.isfinite(rn) & np.isfinite(rs) & (rn >= 0) & (rs >= 0) & (den > C.MIN_DENOMINATOR)
            with np.errstate(invalid="ignore", divide="ignore"):
                ndmi = (rn - rs) / den
            for f in np.flatnonzero(candidate):
                vals = ndmi[(lab == f) & ok]
                valid_final[f] = vals.size
                if vals.size >= C.MIN_PIXELS and vals.size >= C.MIN_COVERAGE * total[f]:
                    ndmi_field[f] = float(np.median(vals))
    rows = []
    for f in np.flatnonzero(total[1:] > 0) + 1:
        rows.append({"field_id": geom.field_ids[f - 1], "scene_id": scene["id"], "date": scene["date"],
                     "total_px": int(total[f]), "valid_px": int(valid_final[f] if candidate[f] else valid[f]),
                     "ndmi": ndmi_field[f]})
    return rows


def run_cluster_season(cluster: str, fields: pd.DataFrame, season: int) -> None:
    out_dir = C.DATA_DIR / "obs"
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / f"{cluster}_{season}.parquet"
    if out.exists():
        return
    geom = ClusterGeometry(fields[fields["cluster"] == cluster])
    t0 = time.time()
    scenes = scene_items(geom.bbox, season)
    rows, failed = [], []
    with ThreadPoolExecutor(WORKERS) as pool:
        futs = {pool.submit(process_scene, s, geom): s for s in scenes}
        for fut in as_completed(futs):
            try:
                rows.extend(fut.result())
            except Exception as e:  # zapisujemy i idziemy dalej; scenę można dociągnąć ponownym uruchomieniem
                failed.append({"scene_id": futs[fut]["id"], "error": repr(e)[:300]})
    df = pd.DataFrame(rows, columns=["field_id", "scene_id", "date", "total_px", "valid_px", "ndmi"])
    df.to_parquet(out, index=False)
    if failed:
        pd.DataFrame(failed).to_csv(out_dir / f"{cluster}_{season}_failed.csv", index=False)
    acc = int(df["ndmi"].notna().sum())
    print(f"{cluster} {season}: scen {len(scenes)}, błędów {len(failed)}, wierszy {len(df)}, "
          f"zaakceptowanych {acc}, {time.time() - t0:.0f} s", flush=True)


def main(argv: list[str]) -> None:
    fields = pd.read_parquet(C.DATA_DIR / "fields.parquet")
    clusters = argv or [c[0] for c in C.CLUSTERS]
    for season in C.SEASONS:
        for cluster in clusters:
            try:
                run_cluster_season(cluster, fields, season)
            except Exception:
                traceback.print_exc()


if __name__ == "__main__":
    main(sys.argv[1:])
