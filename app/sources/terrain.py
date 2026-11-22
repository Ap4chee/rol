"""Teren i spływ: wycinek NMT GUGiK 1 m wokół działki i analiza dróg spływu.

Wycinek pochodzi z arkuszy GeoTIFF na opendata.geoportal.gov.pl (app/sources/nmt_geotiff.py), bo usługa WCS
NMT przestała odpowiadać (22.11.2026). Okno liczymy w EPSG:2180 (PL-1992; x = wschód, y = północ w metrach).
Teren liczy się poza głównym raportem i trafia do pamięci podręcznej.
"""
from __future__ import annotations

import asyncio
import math
import time
from dataclasses import dataclass

import httpx
import numpy as np
from shapely.geometry import LineString, mapping
from shapely.geometry.base import BaseGeometry

from app.config import check_forced_failure
from app.core import flow
from app.core.terrain_rules import Point, TerrainFacts
from app.geo import reproject, transformer
from app.sources import NoData, nmt_geotiff

BUFFER_M = 200.0
THRESHOLD_HA = 0.05
MAX_SIDE_M = 1600.0          # większy wycinek 1 m nie zmieści się w rozsądnym czasie
MAX_CELLS = 700_000          # powyżej tej liczby komórek liczymy na siatce 2 m
DEPRESSION_DEPTH_M = 0.2
SIDES = ("północna", "północno-wschodnia", "wschodnia", "południowo-wschodnia",
         "południowa", "południowo-zachodnia", "zachodnia", "północno-zachodnia")


@dataclass
class TerrainAnalysis:
    facts: TerrainFacts
    flow_paths: dict          # GeoJSON FeatureCollection, EPSG:4326
    crossings: dict           # GeoJSON FeatureCollection, EPSG:4326
    cell_m: float
    buffer_m: float
    fetch_s: float
    compute_s: float


def side_of(dx_east_m: float, dy_north_m: float) -> str:
    """Strona świata dla wektora od środka działki (osiem kierunków)."""
    bearing = math.degrees(math.atan2(dx_east_m, dy_north_m)) % 360.0
    return SIDES[int((bearing + 22.5) // 45) % 8]


def window_bounds(geometry_2180: BaseGeometry) -> tuple[tuple[int, int, int, int], float]:
    """Zasięg wycinka (wschód_min, północ_min, wschód_max, północ_max) w pełnych metrach i użyty bufor."""
    minx, miny, maxx, maxy = geometry_2180.bounds
    buffer_m = BUFFER_M
    while buffer_m > 25 and max(maxx - minx, maxy - miny) + 2 * buffer_m > MAX_SIDE_M:
        buffer_m /= 2
    if max(maxx - minx, maxy - miny) + 2 * buffer_m > MAX_SIDE_M:
        raise NoData("Działka jest zbyt rozległa, żeby policzyć spływ na modelu terenu 1 m w czasie raportu.")
    return (math.floor(minx - buffer_m), math.floor(miny - buffer_m),
            math.ceil(maxx + buffer_m), math.ceil(maxy + buffer_m)), buffer_m


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
        raise NoData("Działka jest za mała, żeby objąć choć jedną komórkę modelu terenu.")
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
                           {"type": "FeatureCollection", "features": features}, cell_m, buffer_m, 0.0,
                           round(time.perf_counter() - t0, 2))


async def terrain_for_parcel(client: httpx.AsyncClient, geometry_4326: BaseGeometry) -> TerrainAnalysis:
    """Pobranie wycinka NMT z buforem wokół działki i pełna analiza spływu."""
    geom = reproject(geometry_4326, "EPSG:4326", "EPSG:2180")
    bounds, buffer_m = window_bounds(geom)
    t0 = time.perf_counter()
    check_forced_failure("terrain")
    dem, transform = await nmt_geotiff.fetch_dem(client, bounds)
    fetch_s = round(time.perf_counter() - t0, 2)
    analysis = await asyncio.to_thread(analyse_parcel, geometry_4326, dem, transform, buffer_m)
    analysis.fetch_s = fetch_s
    return analysis
