"""Teren: wycinek NMT GUGiK 1 m przez WCS wokół działki. Analiza spływu jest w app/core/terrain_analysis.py.

WCS 2.0.1: `mapy.geoportal.gov.pl/wss/service/PZGIK/NMT/GRID1/WCS/DigitalTerrainModelFormatTIFF`,
coverage `DTM_PL-KRON86-NH_TIFF`, `SUBSET=x(wschód_min,wschód_max)&SUBSET=y(północ_min,północ_max)`
w EPSG:2180 (PL-1992; x = wschód, y = północ w metrach), wysokości w układzie PL-KRON86-NH.
Sprawdzone 21.11.2026: zwraca GeoTIFF float32 o oczku 1 m; wycinek 488 × 603 m trwał 13–56 s
(wieczorem nawet 120 s), dlatego teren liczy się poza głównym raportem i trafia do pamięci podręcznej.
"""
from __future__ import annotations

import math
import time
from dataclasses import dataclass

import httpx
import numpy as np
from shapely.geometry.base import BaseGeometry

from app.config import TIMEOUT_TERRAIN_S, check_forced_failure
from app.infra.geo import reproject
from app.sources import NoData, SourceError

WCS_URL = "https://mapy.geoportal.gov.pl/wss/service/PZGIK/NMT/GRID1/WCS/DigitalTerrainModelFormatTIFF"
COVERAGE_ID = "DTM_PL-KRON86-NH_TIFF"
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


async def fetch_dem(client: httpx.AsyncClient, bounds: tuple[int, int, int, int]):
    """Wycinek NMT jako (tablica wysokości [m], transformacja afiniczna rasterio) w EPSG:2180."""
    check_forced_failure("terrain")
    params = [("SERVICE", "WCS"), ("VERSION", "2.0.1"), ("REQUEST", "GetCoverage"), ("COVERAGEID", COVERAGE_ID),
              ("FORMAT", "image/tiff"), ("SUBSET", f"x({bounds[0]},{bounds[2]})"), ("SUBSET", f"y({bounds[1]},{bounds[3]})")]
    try:
        response = await client.get(WCS_URL, params=params, timeout=TIMEOUT_TERRAIN_S)
    except httpx.TimeoutException as exc:
        raise SourceError(f"WCS z modelem terenu nie odpowiedział w {TIMEOUT_TERRAIN_S:.0f} s") from exc
    except httpx.HTTPError as exc:
        raise SourceError(f"WCS z modelem terenu: błąd połączenia ({type(exc).__name__})") from exc
    if response.status_code != 200 or not response.headers.get("content-type", "").startswith("image/tiff"):
        raise SourceError(f"WCS z modelem terenu: HTTP {response.status_code}, odpowiedź nie jest rastrem")
    from rasterio.io import MemoryFile
    try:
        with MemoryFile(response.content) as memfile, memfile.open() as ds:
            dem = ds.read(1).astype(float)
            transform = ds.transform
            nodata = ds.nodata
    except Exception as exc:
        raise SourceError("WCS z modelem terenu zwrócił nieczytelny raster") from exc
    if nodata is not None:
        dem[dem == nodata] = np.nan
    dem[dem < -100] = np.nan
    if dem.size == 0 or not np.isfinite(dem).any():
        raise NoData("Model terenu nie ma danych dla tego miejsca.")
    return dem, transform


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
    dem, transform = await fetch_dem(client, bounds)
    return DemWindow(dem, transform, buffer_m, round(time.perf_counter() - t0, 2))
