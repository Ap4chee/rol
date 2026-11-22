"""Spadek, drogi spływu i punkty dopływu i odpływu na granicy działki z wycinka modelu terenu.

Same obliczenia na gotowym rastrze (EPSG:2180, wysokości w metrach). Pobranie wycinka z WCS GUGiK jest w
app/sources/terrain.py, a zdania dla rolnika w app/core/terrain_rules.py.
"""
from __future__ import annotations

import math
import time
from dataclasses import dataclass

import numpy as np
from shapely.geometry import LineString, mapping
from shapely.geometry.base import BaseGeometry

from app.core import flow
from app.core.terrain_rules import Point, TerrainFacts
from app.infra.geo import reproject, transformer

THRESHOLD_HA = 0.05          # od tej powierzchni zasilającej pokazujemy drogę spływu
MAX_CELLS = 700_000          # powyżej tej liczby komórek liczymy na siatce 2 m
DEPRESSION_DEPTH_M = 0.2     # zagłębienie płytsze niż 20 cm to szum modelu, nie miejsce stagnowania wody
SIDES = ("północna", "północno-wschodnia", "wschodnia", "południowo-wschodnia",
         "południowa", "południowo-zachodnia", "zachodnia", "północno-zachodnia")


class TerrainNotComputable(ValueError):
    """Działka nie obejmuje żadnej komórki modelu terenu."""


@dataclass(frozen=True)
class TerrainAnalysis:
    facts: TerrainFacts
    flow_paths: dict          # GeoJSON FeatureCollection, EPSG:4326
    crossings: dict           # GeoJSON FeatureCollection, EPSG:4326
    cell_m: float
    buffer_m: float
    compute_s: float


def side_of(dx_east_m: float, dy_north_m: float) -> str:
    """Strona świata dla wektora od środka działki (osiem kierunków)."""
    bearing = math.degrees(math.atan2(dx_east_m, dy_north_m)) % 360.0
    return SIDES[int((bearing + 22.5) // 45) % 8]


def analyse_parcel(geometry_4326: BaseGeometry, dem: np.ndarray, transform, buffer_m: float) -> TerrainAnalysis:
    """Spadek, drogi spływu i punkty na granicy działki z wycinka modelu terenu (obliczenia bez sieci)."""
    from rasterio.features import geometry_mask
    from rasterio.transform import Affine

    t0 = time.perf_counter()
    cell_m = float(transform.a)
    if dem.size > MAX_CELLS:   # siatka 2 m: średnia z bloków 2 × 2
        rows, cols = (dem.shape[0] // 2) * 2, (dem.shape[1] // 2) * 2
        dem = dem[:rows, :cols].reshape(rows // 2, 2, cols // 2, 2).mean(axis=(1, 3))
        transform = transform * Affine.scale(2.0)
        cell_m *= 2
    geom = reproject(geometry_4326, "EPSG:4326", "EPSG:2180")
    inside = geometry_mask([mapping(geom)], out_shape=dem.shape, transform=transform, invert=True, all_touched=False)
    if not inside.any():
        raise TerrainNotComputable("Działka jest za mała, żeby objąć choć jedną komórkę modelu terenu.")
    left, top = transform.c, transform.f
    to_lonlat = transformer("EPSG:2180", "EPSG:4326")

    def xy(row: float, col: float) -> tuple[float, float]:
        return left + (col + 0.5) * cell_m, top - (row + 0.5) * cell_m

    result = flow.analyse(dem, inside, cell_m, THRESHOLD_HA * 10_000.0)
    slope = flow.slope_percent(np.where(np.isfinite(dem), dem, np.nanmean(dem)), cell_m)
    centre = geom.centroid

    points, features = [], []
    for crossing in result.crossings:
        x, y = xy(crossing.row, crossing.col)
        side = side_of(x - centre.x, y - centre.y)
        area_ha = crossing.area_m2 / 10_000.0
        points.append(Point(crossing.kind, area_ha, side))
        lon, lat = to_lonlat.transform(x, y)
        features.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [round(lon, 7), round(lat, 7)]},
                         "properties": {"kind": crossing.kind, "area_ha": round(area_ha, 2), "side": side,
                                        "label": f"{area_ha:.2f} ha".replace(".", ",")}})
    line_features = []
    for cells, area_m2 in result.lines:
        line = LineString([xy(r, c) for r, c in cells]).simplify(cell_m, preserve_topology=False)
        lonlat = reproject(line, "EPSG:2180", "EPSG:4326")
        area_ha = area_m2 / 10_000.0
        line_features.append({"type": "Feature", "geometry": mapping(lonlat),
                              "properties": {"area_ha": round(area_ha, 2),
                                             "width": round(min(1.5 + math.log10(max(area_ha, 0.05) / 0.05) * 1.5, 6.0), 1)}})

    depth = np.where(inside, result.filled - np.where(np.isfinite(dem), dem, result.filled), 0.0)
    deep = depth >= DEPRESSION_DEPTH_M
    depression_side = None
    if deep.any():
        r, c = np.unravel_index(int(np.argmax(depth)), depth.shape)
        x, y = xy(float(r), float(c))
        depression_side = side_of(x - centre.x, y - centre.y)
    facts = TerrainFacts(
        elevation_min_m=float(np.nanmin(dem[inside])), elevation_max_m=float(np.nanmax(dem[inside])),
        slope_mean_pct=float(slope[inside].mean()), slope_p90_pct=float(np.percentile(slope[inside], 90)),
        points=points, threshold_ha=THRESHOLD_HA,
        depression_area_m2=float(deep.sum()) * cell_m * cell_m, depression_max_depth_m=float(depth.max()),
        depression_side=depression_side)
    return TerrainAnalysis(facts, {"type": "FeatureCollection", "features": line_features},
                           {"type": "FeatureCollection", "features": features}, cell_m, buffer_m,
                           round(time.perf_counter() - t0, 2))
