"""Pola pilotażowe: kwadraty 80 × 80 m na gruntach ornych według ESA WorldCover 2021 (klasa 40).

Nie mamy potwierdzonego eksportu GSA, więc pole to fragment jednolitego gruntu ornego, a nie granica
deklarowanej uprawy. Typu uprawy nie znamy i model go nie używa.
Wynik: fields.parquet z kolumnami field_id, cluster, lat, lon (środek, EPSG:4326), wkt (EPSG:4326).
"""
from __future__ import annotations

import math

import numpy as np
import pandas as pd
from pyproj import Transformer
from shapely.geometry import box, mapping
from shapely.ops import transform as shp_transform

from . import config as C

TO_2180 = Transformer.from_crs("EPSG:4326", "EPSG:2180", always_xy=True)
TO_4326 = Transformer.from_crs("EPSG:2180", "EPSG:4326", always_xy=True)


def worldcover_tile(lat: float, lon: float) -> str:
    """Nazwa kafla 3 × 3° według lewego dolnego narożnika, np. N51E021."""
    la = math.floor(lat / 3) * 3
    lo = math.floor(lon / 3) * 3
    return f"N{la:02d}E{lo:03d}"


def candidate_squares(lat: float, lon: float) -> list:
    """Siatka kwadratów pól wokół środka skupiska, budowana w EPSG:2180 i zwracana w EPSG:4326."""
    cx, cy = TO_2180.transform(lon, lat)
    half, step, size = C.CLUSTER_HALF_SIZE_M, C.FIELD_SPACING_M, C.FIELD_SIZE_M
    out = []
    for x in np.arange(cx - half + step / 2, cx + half, step):
        for y in np.arange(cy - half + step / 2, cy + half, step):
            sq = box(x - size / 2, y - size / 2, x + size / 2, y + size / 2)
            out.append(shp_transform(TO_4326.transform, sq))
    return out


def cropland_fraction(squares: list, lat: float, lon: float) -> np.ndarray:
    import rasterio
    from rasterio.features import rasterize
    from rasterio.windows import from_bounds

    minx = min(s.bounds[0] for s in squares); miny = min(s.bounds[1] for s in squares)
    maxx = max(s.bounds[2] for s in squares); maxy = max(s.bounds[3] for s in squares)
    tiles = {worldcover_tile(miny, minx), worldcover_tile(maxy, maxx)}
    if len(tiles) > 1:  # skupisko na granicy kafli: liczymy pola z każdego kafla osobno
        frac = np.zeros(len(squares))
        for tile in tiles:
            frac = np.maximum(frac, _fraction_from_tile(squares, tile))
        return frac
    return _fraction_from_tile(squares, tiles.pop())


def _fraction_from_tile(squares: list, tile: str) -> np.ndarray:
    import rasterio
    from rasterio.features import rasterize
    from rasterio.windows import from_bounds

    minx = min(s.bounds[0] for s in squares); miny = min(s.bounds[1] for s in squares)
    maxx = max(s.bounds[2] for s in squares); maxy = max(s.bounds[3] for s in squares)
    with rasterio.open(C.WORLDCOVER_URL.format(tile=tile)) as ds:
        win = from_bounds(minx, miny, maxx, maxy, ds.transform).round_offsets().round_lengths()
        lc = ds.read(1, window=win, boundless=True, fill_value=0)
        tr = ds.window_transform(win)
    labels = rasterize([(mapping(s), i + 1) for i, s in enumerate(squares)], out_shape=lc.shape,
                       transform=tr, fill=0, all_touched=False, dtype="int32")
    n = len(squares) + 1
    total = np.bincount(labels.ravel(), minlength=n)[1:]
    crop = np.bincount(labels[lc == C.WORLDCOVER_CROPLAND].ravel(), minlength=n)[1:]
    with np.errstate(invalid="ignore", divide="ignore"):
        return np.where(total > 0, crop / np.maximum(total, 1), 0.0)


def build_fields() -> pd.DataFrame:
    rng = np.random.default_rng(C.RANDOM_SEED)
    rows = []
    for name, lat, lon in C.CLUSTERS:
        squares = candidate_squares(lat, lon)
        frac = cropland_fraction(squares, lat, lon)
        ok = np.flatnonzero(frac >= C.FIELD_MIN_CROPLAND)
        pick = rng.choice(ok, size=min(C.FIELDS_PER_CLUSTER, len(ok)), replace=False) if len(ok) else []
        for k, i in enumerate(sorted(pick)):
            c = squares[i].centroid
            rows.append({"field_id": f"{name}_{k:03d}", "cluster": name, "lat": c.y, "lon": c.x,
                         "cropland_fraction": float(frac[i]), "wkt": squares[i].wkt})
        print(f"{name}: kandydatów {len(squares)}, grunty orne {len(ok)}, wybrano {len(pick)}", flush=True)
    return pd.DataFrame(rows)


def main() -> None:
    C.DATA_DIR.mkdir(parents=True, exist_ok=True)
    out = C.DATA_DIR / "fields.parquet"
    if out.exists():
        print(f"{out} już jest"); return
    df = build_fields()
    df.to_parquet(out, index=False)
    print(f"zapisano {len(df)} pól -> {out}")


if __name__ == "__main__":
    main()
