"""Teren: wycinek NMT GUGiK 1 m wokół działki. Analiza spływu jest w app/core/terrain_analysis.py.

Wycinek pochodzi z arkuszy GeoTIFF na opendata.geoportal.gov.pl (app/sources/nmt_geotiff.py), bo usługa WCS
NMT przestała odpowiadać (22.11.2026). Okno liczymy w EPSG:2180 (PL-1992; x = wschód, y = północ w metrach).
Teren liczy się poza głównym raportem i trafia do pamięci podręcznej.
"""
from __future__ import annotations

import math
import time
from dataclasses import dataclass

import httpx
import numpy as np
from shapely.geometry.base import BaseGeometry

from app.config import check_forced_failure
from app.infra.geo import reproject
from app.sources import NoData, nmt_geotiff

BUFFER_M = 200.0
MAX_SIDE_M = 1600.0          # większy wycinek 1 m nie zmieści się w rozsądnym czasie


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


@dataclass(frozen=True)
class DemWindow:
    """Wycinek NMT wokół działki: wysokości [m], transformacja rasterio (EPSG:2180) i użyty bufor."""
    dem: np.ndarray
    transform: object
    buffer_m: float
    fetch_s: float


async def fetch_parcel_dem(client: httpx.AsyncClient, geometry_4326: BaseGeometry) -> DemWindow:
    """Wycinek NMT z buforem wokół działki."""
    bounds, buffer_m = window_bounds(reproject(geometry_4326, "EPSG:4326", "EPSG:2180"))
    t0 = time.perf_counter()
    check_forced_failure("terrain")
    dem, transform = await nmt_geotiff.fetch_dem(client, bounds)
    return DemWindow(dem, transform, buffer_m, round(time.perf_counter() - t0, 2))
