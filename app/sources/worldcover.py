"""Pokrycie terenu na działce z mapy ESA WorldCover 10 m (2021, v200).

Mapa leży w otwartym zasobniku AWS jako pliki COG po 3° × 3° w EPSG:4326 (piksel 1/12000°, w Polsce ok. 6 × 9 m).
Czytamy tylko okno pod działką (rasterio przez HTTP, zapytania zakresowe), bez konta i klucza.
Sprawdzone prawdziwym odczytem 22.11.2026: arkusz N51E021, okno 60 × 60 pikseli, 1,4 s.

Wartości pikseli to kody klas (10 drzewa, 30 trawy, 40 grunty orne, 50 zabudowa, 80 woda…), 0 = brak danych.
"""
from __future__ import annotations

import math

from shapely.geometry.base import BaseGeometry

from app.config import check_forced_failure
from app.infra import cache
from app.sources import NoData, SourceError

SOURCE_NAME = "ESA WorldCover 10 m 2021 v200 (pokrycie terenu)"
URL = "https://esa-worldcover.org/"
LICENSE = "CC BY 4.0"
ATTRIBUTION = ("© ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) "
               "processed by ESA WorldCover consortium")
MAP_YEAR = 2021
TILE_URL = "https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_{tile}_Map.tif"
TILE_DEG = 3
GDAL_OPTIONS = {
    "GDAL_DISABLE_READDIR_ON_OPEN": "EMPTY_DIR",
    "CPL_VSIL_CURL_ALLOWED_EXTENSIONS": ".tif",
    "GDAL_HTTP_MERGE_CONSECUTIVE_RANGES": "YES",
    "GDAL_HTTP_TIMEOUT": "12",
    "GDAL_HTTP_MAX_RETRY": "1",
}
# okno większe niż ok. 20 × 30 km nie jest działką; chroni przed pobraniem całego arkusza
MAX_WINDOW_PX = 4000
MIN_CENTER_PIXELS = 10


def tile_name(lon: float, lat: float) -> str:
    """Nazwa arkusza 3° × 3° po jego lewym dolnym rogu, np. N51E021 dla punktu (22,4; 51,1)."""
    lat0 = math.floor(lat / TILE_DEG) * TILE_DEG
    lon0 = math.floor(lon / TILE_DEG) * TILE_DEG
    return f"{'N' if lat0 >= 0 else 'S'}{abs(lat0):02d}{'E' if lon0 >= 0 else 'W'}{abs(lon0):03d}"


def _read_counts(geometry: BaseGeometry) -> dict[int, int]:
    """Liczba pikseli na klasę dla pikseli działki (albo jednego piksela pod punktem)."""
    import numpy as np
    import rasterio
    from rasterio.errors import RasterioError
    from rasterio.features import geometry_mask
    from rasterio.windows import Window, from_bounds
    from rasterio.windows import transform as window_transform

    center = geometry.centroid
    url = TILE_URL.format(tile=tile_name(center.x, center.y))
    try:
        with rasterio.Env(**GDAL_OPTIONS), rasterio.open(url) as ds:
            raw = from_bounds(*geometry.bounds, ds.transform)
            col0, row0 = math.floor(raw.col_off), math.floor(raw.row_off)
            col1, row1 = math.ceil(raw.col_off + raw.width), math.ceil(raw.row_off + raw.height)
            # działka na styku arkuszy: bierzemy część leżącą w arkuszu jej środka
            col0, row0, col1, row1 = max(col0, 0), max(row0, 0), min(col1, ds.width), min(row1, ds.height)
            width, height = max(col1 - col0, 1), max(row1 - row0, 1)
            if width > MAX_WINDOW_PX or height > MAX_WINDOW_PX:
                raise NoData("obszar jest za duży na działkę, nie czytam mapy pokrycia terenu")
            window = Window(col0, row0, width, height)
            data = ds.read(1, window=window)
            transform = window_transform(window, ds.transform)
            # piksele, których środek leży w działce; dla wąskiej działki albo punktu wszystkie, których dotyka
            inside = geometry_mask([geometry], out_shape=data.shape, transform=transform, invert=True)
            if int(inside.sum()) < MIN_CENTER_PIXELS:
                inside = geometry_mask([geometry], out_shape=data.shape, transform=transform, invert=True,
                                       all_touched=True)
    except RasterioError as exc:
        raise SourceError(f"mapa ESA WorldCover nie odpowiedziała poprawnie ({type(exc).__name__})") from exc
    codes, counts = np.unique(data[inside & (data != 0)], return_counts=True)
    return {int(code): int(n) for code, n in zip(codes, counts, strict=True)}


def fetch_counts(geometry: BaseGeometry) -> tuple[dict[int, int], bool]:
    """Kod klasy → liczba pikseli dla działki albo punktu w EPSG:4326. Funkcja blokująca (odczyt rastra):
    wywołuj przez asyncio.to_thread. Drugi element: czy wynik pochodzi z pamięci podręcznej."""
    check_forced_failure("land_use")
    key = geometry.wkt
    cached = cache.get("worldcover", key)   # mapa z 2021 r. się nie zmienia, wpis nie ma terminu
    if cached is not None:
        return {int(code): int(n) for code, n in cached.items()}, True
    counts = _read_counts(geometry)
    if not counts:
        raise NoData("mapa pokrycia terenu nie ma danych dla tego miejsca")
    cache.put("worldcover", key, {str(code): n for code, n in counts.items()})
    return counts, False
