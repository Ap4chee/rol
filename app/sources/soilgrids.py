"""Gleba z ISRIC SoilGrids 250 m v2.0: uziarnienie, węgiel organiczny i gęstość w sześciu warstwach.

Trzy drogi dostępu do tych samych danych, w kolejności według zmierzonego czasu (21.11.2026):
1. WCS `maps.isric.org` – jedno małe zapytanie na warstwę, 0,4–2,6 s, zwraca od razu wszystkie
   komórki 250 m pod działką (54 warstwy równolegle w kilka sekund).
2. REST `rest.isric.org/soilgrids/v2.0/properties/query` – zapytanie o środek komórki; pełny zestaw
   właściwości trwał 11,8 s, obowiązuje limit 5 zapytań na minutę, a ISRIC ogłosił wstrzymanie usługi.
3. Kafle GeoTIFF z `files.isric.org` przez /vsicurl/ – serwer oddaje ok. 100 kB/s (54 warstwy
   to ok. 60 s na zimno), więc w tym trybie czytamy tylko średnie piasku, iłu i węgla (bez kwantyli).
   Położenie kafli pochodzi z lokalnego indeksu `app/data/soilgrids_tiles_pl.json` zbudowanego z pliku VRT.

Układ: Interrupted Goode Homolosine (równopowierzchniowy), siatka 250 m, liczby całkowite Int16,
brak danych −32768. Gdy działka przecina kilka komórek, liczymy średnią ważoną powierzchnią przecięcia.
Jednostki źródłowe: piasek/pył/ił g/kg, węgiel organiczny dg/kg, gęstość cg/cm³.
"""
from __future__ import annotations

import asyncio
import json
import math
import os
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

import httpx
import numpy as np
from pyproj import CRS, Transformer
from shapely.geometry import box
from shapely.geometry.base import BaseGeometry

from app import cache
from app.config import TIMEOUT_SOIL_REST_S, check_forced_failure
from app.core.soil import Layer
from app.geo import reproject
from app.sources import NoData, SourceError

HOMOLOSINE_PROJ4 = "+proj=igh +lat_0=0 +lon_0=0 +datum=WGS84 +units=m +no_defs"
ORIGIN_X_M, ORIGIN_Y_M, PIXEL_M = -19949750.0, 8361000.0, 250.0  # z nagłówka VRT SoilGrids
NODATA = -32768

DEPTHS = [(0, 5), (5, 15), (15, 30), (30, 60), (60, 100), (100, 200)]
# dzielnik przeliczający jednostki źródłowe na: % (frakcje), g/kg (węgiel), g/cm3 (gęstość)
DIVISOR = {"sand": 10.0, "silt": 10.0, "clay": 10.0, "soc": 10.0, "bdod": 100.0}
FULL_LAYERS = ([(p, s) for p in ("sand", "clay") for s in ("mean", "Q0.05", "Q0.95")]
               + [(p, "mean") for p in ("silt", "soc", "bdod")])
REDUCED_LAYERS = [("sand", "mean"), ("clay", "mean"), ("soc", "mean")]

WCS_URL = "https://maps.isric.org/mapserv"
WCS_CRS = "http://www.opengis.net/def/crs/EPSG/0/152160"
REST_URL = "https://rest.isric.org/soilgrids/v2.0/properties/query"
TILES_BASE = "https://files.isric.org/soilgrids/latest/data"
TILE_INDEX_PATH = Path(__file__).resolve().parent.parent / "data" / "soilgrids_tiles_pl.json"

WCS_CONCURRENCY = 16
WCS_TIMEOUT_S = 8.0
REST_MAX_CELLS = 4
TILES_TIMEOUT_S = 25.0
MAX_CELLS = 400  # ok. 2500 ha; większe wejście nie jest pojedynczą działką rolną


def depth_label(top: int, bottom: int) -> str:
    return f"{top}-{bottom}cm"


@dataclass
class CellGrid:
    """Okno siatki SoilGrids pod działką i wagi komórek (udział w powierzchni działki)."""
    col0: int
    row0: int
    ncols: int
    nrows: int
    weights: np.ndarray  # kształt (nrows, ncols), suma 1

    @property
    def cells(self) -> int:
        return int((self.weights > 0).sum())

    def bounds_m(self) -> tuple[float, float, float, float]:
        x0 = ORIGIN_X_M + self.col0 * PIXEL_M
        y1 = ORIGIN_Y_M - self.row0 * PIXEL_M
        return x0, y1 - self.nrows * PIXEL_M, x0 + self.ncols * PIXEL_M, y1

    def key(self) -> str:
        return f"{self.col0}:{self.row0}:{self.ncols}:{self.nrows}"


def cell_grid(geometry: BaseGeometry) -> CellGrid:
    """Komórki 250 m przecięte przez geometrię (EPSG:4326) i ich wagi powierzchniowe.

    Punkt (raport bez granic działki) daje jedną komórkę o wadze 1.
    """
    geom_m = reproject(geometry, "EPSG:4326", HOMOLOSINE_PROJ4)
    minx, miny, maxx, maxy = geom_m.bounds
    col0 = math.floor((minx - ORIGIN_X_M) / PIXEL_M)
    col1 = math.floor((maxx - ORIGIN_X_M) / PIXEL_M)
    row0 = math.floor((ORIGIN_Y_M - maxy) / PIXEL_M)
    row1 = math.floor((ORIGIN_Y_M - miny) / PIXEL_M)
    ncols, nrows = col1 - col0 + 1, row1 - row0 + 1
    if ncols * nrows > MAX_CELLS:
        raise NoData("Obszar jest za duży na analizę gleby jednej działki.")
    weights = np.zeros((nrows, ncols))
    if geom_m.area <= 0:
        weights[0, 0] = 1.0
        return CellGrid(col0, row0, ncols, nrows, weights)
    for r in range(nrows):
        for c in range(ncols):
            x0 = ORIGIN_X_M + (col0 + c) * PIXEL_M
            y1 = ORIGIN_Y_M - (row0 + r) * PIXEL_M
            weights[r, c] = geom_m.intersection(box(x0, y1 - PIXEL_M, x0 + PIXEL_M, y1)).area
    total = weights.sum()
    if total <= 0:
        raise NoData("Geometria działki nie przecina siatki SoilGrids.")
    return CellGrid(col0, row0, ncols, nrows, weights / total)


def weighted_mean(values: np.ndarray, weights: np.ndarray) -> float | None:
    """Średnia ważona po komórkach z danymi (NaN = brak). None, gdy żadna komórka nie ma danych."""
    ok = np.isfinite(values) & (weights > 0)
    if not ok.any():
        return None
    return float((values[ok] * weights[ok]).sum() / weights[ok].sum())


@dataclass
class SoilData:
    layers: list[Layer]
    cells: int
    method: str           # wcs | rest | tiles
    method_label: str
    from_cache: bool = False
    notes: list[str] = field(default_factory=list)
    attempts: list[str] = field(default_factory=list)  # nieudane drogi dostępu z powodem


def layers_from_values(values: dict[str, np.ndarray], grid: CellGrid) -> list[Layer]:
    """Warstwy gleby ze średnich ważonych. `values[klucz]` to tablica (nrows, ncols) w jednostkach źródłowych.

    Klucz: "<właściwość>_<głębokość>_<statystyka>", np. "sand_0-5cm_mean". Brak danych = NaN.
    """
    def get(prop: str, depth: str, stat: str) -> float | None:
        arr = values.get(f"{prop}_{depth}_{stat}")
        if arr is None:
            return None
        mean = weighted_mean(np.asarray(arr, dtype=float), grid.weights)
        return None if mean is None else mean / DIVISOR[prop]

    layers: list[Layer] = []
    for top, bottom in DEPTHS:
        depth = depth_label(top, bottom)
        sand, clay = get("sand", depth, "mean"), get("clay", depth, "mean")
        if sand is None or clay is None:
            raise NoData("SoilGrids nie ma danych o uziarnieniu dla tej działki (np. teren zabudowany albo woda).")
        silt = get("silt", depth, "mean")
        if silt is None:
            silt = max(100.0 - sand - clay, 0.0)
        layers.append(Layer(
            top_cm=top, bottom_cm=bottom, sand_pct=sand, silt_pct=silt, clay_pct=clay,
            soc_g_kg=get("soc", depth, "mean"), bulk_density_g_cm3=get("bdod", depth, "mean"),
            sand_q05_pct=get("sand", depth, "Q0.05"), sand_q95_pct=get("sand", depth, "Q0.95"),
            clay_q05_pct=get("clay", depth, "Q0.05"), clay_q95_pct=get("clay", depth, "Q0.95")))
    return layers


def _clean(arr: np.ndarray) -> np.ndarray:
    out = np.asarray(arr, dtype=float)
    out[out <= NODATA] = np.nan
    return out


def _mask_empty_cells(values: dict[str, np.ndarray]) -> None:
    """Komórki zamaskowane w SoilGrids (zabudowa, woda) mają wszędzie 0: traktujemy je jako brak danych."""
    sand, clay = values.get("sand_0-5cm_mean"), values.get("clay_0-5cm_mean")
    if sand is None or clay is None:
        return
    empty = (np.nan_to_num(sand) == 0) & (np.nan_to_num(clay) == 0)
    if empty.any():
        for arr in values.values():
            arr[empty] = np.nan


# ---------- 1. WCS ----------

def _read_tiff_bytes(content: bytes, nrows: int, ncols: int) -> np.ndarray:
    from rasterio.io import MemoryFile
    with MemoryFile(content) as memfile, memfile.open() as ds:
        arr = ds.read(1)
    if arr.shape != (nrows, ncols):
        raise SourceError(f"WCS SoilGrids zwrócił wycinek {arr.shape}, oczekiwano {(nrows, ncols)}")
    return _clean(arr)


async def fetch_wcs(client: httpx.AsyncClient, grid: CellGrid) -> tuple[dict[str, np.ndarray], bool]:
    key = f"wcs:{grid.key()}"
    cached = cache.get("soil", key)
    if cached:
        return {k: np.array(v, dtype=float) for k, v in cached.items()}, True
    check_forced_failure("soil_wcs")
    x0, y0, x1, y1 = grid.bounds_m()
    semaphore = asyncio.Semaphore(WCS_CONCURRENCY)

    async def one(prop: str, depth: str, stat: str) -> tuple[str, np.ndarray | None]:
        name = f"{prop}_{depth}_{stat}"
        params = [("map", f"/map/{prop}.map"), ("SERVICE", "WCS"), ("VERSION", "2.0.1"), ("REQUEST", "GetCoverage"),
                  ("COVERAGEID", name), ("FORMAT", "image/tiff"),
                  ("SUBSET", f"X({x0:.0f},{x1:.0f})"), ("SUBSET", f"Y({y0:.0f},{y1:.0f})"),
                  ("SUBSETTINGCRS", WCS_CRS), ("OUTPUTCRS", WCS_CRS)]
        for _attempt in range(2):
            try:
                async with semaphore:
                    response = await client.get(WCS_URL, params=params, timeout=WCS_TIMEOUT_S)
                if response.status_code == 200 and response.headers.get("content-type", "").startswith("image/tiff"):
                    return name, _read_tiff_bytes(response.content, grid.nrows, grid.ncols)
            except (httpx.HTTPError, SourceError, OSError, ValueError):
                continue
        return name, None

    results = await asyncio.gather(*[one(p, depth_label(*d), s) for p, s in FULL_LAYERS for d in DEPTHS])
    values = {name: arr for name, arr in results if arr is not None}
    required = [f"{p}_{depth_label(*d)}_mean" for p in ("sand", "clay") for d in DEPTHS]
    missing = [name for name in required if name not in values]
    if missing:
        raise SourceError(f"WCS SoilGrids nie zwrócił {len(missing)} z {len(required)} wymaganych warstw")
    _mask_empty_cells(values)
    if len(values) == len(results):
        cache.put("soil", key, {k: np.where(np.isfinite(v), v, None).tolist() for k, v in values.items()})
    return values, False


# ---------- 2. REST ----------

def parse_rest(payload: dict) -> dict[str, float]:
    """Wartości z odpowiedzi REST jako słownik "<właściwość>_<głębokość>_<statystyka>" → liczba źródłowa."""
    out: dict[str, float] = {}
    try:
        for layer in payload["properties"]["layers"]:
            for depth in layer["depths"]:
                for stat, value in depth["values"].items():
                    if value is not None:
                        out[f"{layer['name']}_{depth['label']}_{stat}"] = float(value)
    except (KeyError, TypeError, ValueError) as exc:
        raise SourceError("REST SoilGrids: nieoczekiwany układ odpowiedzi") from exc
    return out


async def fetch_rest(client: httpx.AsyncClient, grid: CellGrid) -> tuple[dict[str, np.ndarray], bool, CellGrid]:
    """Zapytania o środki najwyżej czterech komórek o największej wadze. Zwraca też okno z przeskalowanymi wagami."""
    order = np.dstack(np.unravel_index(np.argsort(-grid.weights, axis=None), grid.weights.shape))[0]
    chosen = [(int(r), int(c)) for r, c in order if grid.weights[r, c] > 0][:REST_MAX_CELLS]
    weights = np.zeros_like(grid.weights)
    for r, c in chosen:
        weights[r, c] = grid.weights[r, c]
    used = CellGrid(grid.col0, grid.row0, grid.ncols, grid.nrows, weights / weights.sum())
    to_lonlat = Transformer.from_crs(CRS.from_proj4(HOMOLOSINE_PROJ4), "EPSG:4326", always_xy=True)
    all_cached = True

    async def one(r: int, c: int) -> dict[str, float]:
        nonlocal all_cached
        key = f"rest:{grid.col0 + c}:{grid.row0 + r}"
        cached = cache.get("soil", key)
        if cached:
            return cached
        all_cached = False
        check_forced_failure("soil_rest")
        x = ORIGIN_X_M + (grid.col0 + c + 0.5) * PIXEL_M
        y = ORIGIN_Y_M - (grid.row0 + r + 0.5) * PIXEL_M
        lon, lat = to_lonlat.transform(x, y)
        params = ([("lon", f"{lon:.6f}"), ("lat", f"{lat:.6f}")]
                  + [("property", p) for p in ("sand", "clay", "silt", "soc", "bdod")]
                  + [("depth", depth_label(*d)) for d in DEPTHS]
                  + [("value", s) for s in ("mean", "Q0.05", "Q0.95")])
        try:
            response = await client.get(REST_URL, params=params, timeout=TIMEOUT_SOIL_REST_S)
        except httpx.TimeoutException as exc:
            raise SourceError(f"REST SoilGrids: brak odpowiedzi w {TIMEOUT_SOIL_REST_S:.0f} s") from exc
        except httpx.HTTPError as exc:
            raise SourceError(f"REST SoilGrids: błąd połączenia ({type(exc).__name__})") from exc
        if response.status_code != 200:
            raise SourceError(f"REST SoilGrids: HTTP {response.status_code}")
        try:
            parsed = parse_rest(response.json())
        except ValueError as exc:
            raise SourceError("REST SoilGrids: odpowiedź nie jest poprawnym JSON") from exc
        cache.put("soil", key, parsed)
        return parsed

    per_cell = await asyncio.gather(*[one(r, c) for r, c in chosen])
    values: dict[str, np.ndarray] = {}
    for (r, c), cell in zip(chosen, per_cell):
        for name, value in cell.items():
            values.setdefault(name, np.full(grid.weights.shape, np.nan))[r, c] = value
    _mask_empty_cells(values)
    return values, all_cached, used


# ---------- 3. kafle GeoTIFF przez /vsicurl/ ----------

@lru_cache(maxsize=1)
def tile_index() -> dict:
    with TILE_INDEX_PATH.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def tile_for_cell(col: int, row: int) -> tuple[str, int, int] | None:
    """Ścieżka kafla i położenie komórki w kaflu (kolumna, wiersz) albo None poza indeksem."""
    for path, x_off, y_off, width, height in tile_index()["tiles"]:
        if x_off <= col < x_off + width and y_off <= row < y_off + height:
            return path, col - x_off, row - y_off
    return None


def _read_tiles_blocking(grid: CellGrid, layers: list[tuple[str, str]]) -> dict[str, np.ndarray]:
    os.environ.setdefault("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR")
    os.environ.setdefault("CPL_VSIL_CURL_ALLOWED_EXTENSIONS", ".tif")
    os.environ.setdefault("GDAL_HTTP_TIMEOUT", "12")
    import rasterio
    from rasterio.windows import Window

    cells = [(r, c) for r in range(grid.nrows) for c in range(grid.ncols) if grid.weights[r, c] > 0]
    located = {(r, c): tile_for_cell(grid.col0 + c, grid.row0 + r) for r, c in cells}
    if any(v is None for v in located.values()):
        raise NoData("Komórka gleby leży poza lokalnym indeksem kafli SoilGrids dla Polski.")
    jobs = [(prop, depth_label(*d), stat) for prop, stat in layers for d in DEPTHS]

    def read(job: tuple[str, str, str]) -> tuple[str, np.ndarray]:
        prop, depth, stat = job
        name = f"{prop}_{depth}_{stat}"
        out = np.full(grid.weights.shape, np.nan)
        by_tile: dict[str, list[tuple[int, int, int, int]]] = {}
        for (r, c), (path, tc, tr) in located.items():
            by_tile.setdefault(path, []).append((r, c, tc, tr))
        for path, items in by_tile.items():
            with rasterio.open(f"/vsicurl/{TILES_BASE}/{prop}/{name}/{path}") as ds:
                for r, c, tc, tr in items:
                    out[r, c] = float(ds.read(1, window=Window(tc, tr, 1, 1))[0, 0])
        return name, _clean(out)

    with ThreadPoolExecutor(max_workers=8) as pool:
        return dict(pool.map(read, jobs))


async def fetch_tiles(grid: CellGrid) -> tuple[dict[str, np.ndarray], bool]:
    key = f"tiles:{grid.key()}"
    cached = cache.get("soil", key)
    if cached:
        return {k: np.array(v, dtype=float) for k, v in cached.items()}, True
    check_forced_failure("soil_vrt")
    try:
        values = await asyncio.wait_for(asyncio.to_thread(_read_tiles_blocking, grid, REDUCED_LAYERS), TILES_TIMEOUT_S)
    except asyncio.TimeoutError as exc:
        raise SourceError(f"kafle SoilGrids: brak odpowiedzi w {TILES_TIMEOUT_S:.0f} s") from exc
    except (NoData, SourceError):
        raise
    except Exception as exc:  # rasterio zgłasza różne wyjątki przy błędach sieci
        raise SourceError(f"kafle SoilGrids: błąd odczytu ({type(exc).__name__})") from exc
    _mask_empty_cells(values)
    cache.put("soil", key, {k: np.where(np.isfinite(v), v, None).tolist() for k, v in values.items()})
    return values, False


# ---------- wybór drogi ----------

METHOD_LABELS = {
    "wcs": "WCS maps.isric.org, średnia ważona powierzchnią komórek 250 m pod działką",
    "rest": "REST rest.isric.org, środki komórek 250 m, średnia ważona powierzchnią",
    "tiles": "kafle GeoTIFF files.isric.org (tryb awaryjny: same średnie, bez kwantyli)",
}


async def fetch_soil(client: httpx.AsyncClient, geometry: BaseGeometry) -> SoilData:
    """Warstwy gleby dla geometrii w EPSG:4326 (wielokąt działki albo punkt)."""
    grid = cell_grid(geometry)
    attempts: list[str] = []
    notes: list[str] = []

    try:
        values, from_cache = await fetch_wcs(client, grid)
        layers = layers_from_values(values, grid)
        if any(layer.sand_q05_pct is None for layer in layers):
            notes.append("WCS nie zwrócił części kwantyli, więc przedziału niepewności gleby nie policzono.")
        return SoilData(layers, grid.cells, "wcs", METHOD_LABELS["wcs"], from_cache, notes, attempts)
    except NoData:
        raise
    except (SourceError, RuntimeError) as exc:
        attempts.append(f"WCS: {exc}")

    try:
        values, from_cache, used = await fetch_rest(client, grid)
        layers = layers_from_values(values, used)
        if used.cells < grid.cells:
            notes.append(f"REST: użyto {used.cells} z {grid.cells} komórek pod działką (limit zapytań usługi).")
        return SoilData(layers, used.cells, "rest", METHOD_LABELS["rest"], from_cache, notes, attempts)
    except NoData:
        raise
    except (SourceError, RuntimeError) as exc:
        attempts.append(f"REST: {exc}")

    try:
        values, from_cache = await fetch_tiles(grid)
        layers = layers_from_values(values, grid)
        notes.append("Tryb awaryjny: pobrano tylko średnie piasku, iłu i węgla organicznego, bez kwantyli i gęstości.")
        return SoilData(layers, grid.cells, "tiles", METHOD_LABELS["tiles"], from_cache, notes, attempts)
    except NoData:
        raise
    except (SourceError, RuntimeError) as exc:
        attempts.append(f"kafle: {exc}")
    raise SourceError("; ".join(attempts))
