"""Numeryczny model terenu GUGiK 1 m z arkuszy na serwerze opendata.geoportal.gov.pl, trzymanych lokalnie jako GeoTIFF.

Usługa WCS NMT (`mapy.geoportal.gov.pl/.../NMT/GRID1/WCS`) przestała odpowiadać 22.11.2026 (timeout przy każdym
wycinku), a same pliki arkuszy nadal da się pobrać bezpośrednio z `opendata.geoportal.gov.pl/NumDaneWys/NMT/...`.
Dlatego wycinek składamy sami:
1. skorowidz WFS (`NumerycznyModelTerenuEVRF2007/WFS/Skorowidze`, warstwy `gugik:SkorowidzNMT<rok>`) mówi, które
   arkusze pokrywają okno i pod jakim adresem leżą (`url_do_pobrania`); bierzemy najnowszy rocznik z oczkiem 1 m;
2. arkusz pobieramy raz (ASCII GRID ok. 36 MB, GeoTIFF też obsługujemy) i zapisujemy w `cache/nmt/` jako
   skompresowany kafelkowany GeoTIFF, więc kolejne działki z tego samego arkusza nie idą już do sieci;
3. z GeoTIFF-a czytamy tylko okno wokół działki, a kilka arkuszy na styku sklejamy `rasterio.merge`.
Wysokości w układzie PL-EVRF2007-NH, siatka w PL-1992 (EPSG:2180, x = wschód, y = północ).
"""
from __future__ import annotations

import asyncio
import os
import tempfile
from dataclasses import dataclass
from pathlib import Path
from xml.etree import ElementTree

import httpx
import numpy as np

from app.config import CACHE_DIR
from app.sources import NoData, SourceError

INDEX_URL = "https://mapy.geoportal.gov.pl/wss/service/PZGIK/NumerycznyModelTerenuEVRF2007/WFS/Skorowidze"
INDEX_YEARS = tuple(range(2026, 2017, -1))   # najpierw najnowsze naloty
INDEX_TIMEOUT_S = 30.0
DOWNLOAD_TIMEOUT_S = 180.0
SHEETS_DIR = CACHE_DIR / "nmt"
NODATA = -9999.0
_GUGIK_NS = "{http://www.gugik.gov.pl}"
_locks: dict[str, asyncio.Lock] = {}


@dataclass(frozen=True)
class Sheet:
    godlo: str
    year: int
    url: str

    @property
    def tif_path(self) -> Path:
        return SHEETS_DIR / (Path(self.url.split("?")[0]).stem + ".tif")


def _parse_features(xml_text: str) -> list[dict]:
    """Atrybuty obiektów z odpowiedzi GML skorowidza (geometria nie jest potrzebna)."""
    features = []
    for member in ElementTree.fromstring(xml_text):
        for feature in member:
            props = {child.tag[len(_GUGIK_NS):]: child.text.strip() for child in feature
                     if child.tag.startswith(_GUGIK_NS) and child.text and child.text.strip()}
            if props:
                features.append(props)
    return features


def _usable(props: dict) -> bool:
    """Arkusz z oczkiem 1 m w formacie, który umiemy przeczytać (ASCII GRID albo GeoTIFF)."""
    url = (props.get("url_do_pobrania") or "").lower().split("?")[0]
    cell = (props.get("char_przestrz") or "").replace(",", ".")
    return url.endswith((".asc", ".tif", ".tiff")) and cell.startswith("1.0") and props.get("czy_ark_wypelniony") != "NIE"


async def _sheets_for_year(client: httpx.AsyncClient, year: int, bounds: tuple[int, int, int, int]) -> list[Sheet]:
    # WFS 2.0 z urn EPSG:2180 wymaga kolejności osi północ, wschód
    bbox = f"{bounds[1]},{bounds[0]},{bounds[3]},{bounds[2]},urn:ogc:def:crs:EPSG::2180"
    params = {"SERVICE": "WFS", "VERSION": "2.0.0", "REQUEST": "GetFeature",
              "TYPENAMES": f"gugik:SkorowidzNMT{year}", "BBOX": bbox, "COUNT": "50"}
    response = await client.get(INDEX_URL, params=params, timeout=INDEX_TIMEOUT_S)
    response.raise_for_status()
    return [Sheet(f.get("godlo", ""), year, f["url_do_pobrania"]) for f in _parse_features(response.text) if _usable(f)]


async def find_sheets(client: httpx.AsyncClient, bounds: tuple[int, int, int, int]) -> list[Sheet]:
    """Arkusze 1 m z najnowszego rocznika skorowidza, który ma arkusz w oknie (roczniki pytamy równolegle)."""
    results = await asyncio.gather(*(_sheets_for_year(client, year, bounds) for year in INDEX_YEARS),
                                   return_exceptions=True)
    errors = [r for r in results if isinstance(r, BaseException)]
    for sheets in results:
        if isinstance(sheets, list) and sheets:
            return sheets
    if errors and len(errors) == len(results):
        raise SourceError(f"skorowidz arkuszy NMT GUGiK nie odpowiedział poprawnie ({type(errors[0]).__name__})")
    raise NoData("W skorowidzu GUGiK nie ma arkusza NMT 1 m dla tego miejsca.")


def _to_geotiff(src_path: Path, dst_path: Path) -> None:
    """Arkusz (ASCII GRID lub GeoTIFF) do kafelkowanego GeoTIFF float32 z kompresją, w EPSG:2180."""
    import rasterio
    from rasterio.crs import CRS

    with rasterio.open(src_path) as src:
        data = src.read(1).astype("float32")
        if src.nodata is not None:
            data[data == src.nodata] = NODATA
        profile = {"driver": "GTiff", "height": src.height, "width": src.width, "count": 1, "dtype": "float32",
                   "crs": src.crs or CRS.from_epsg(2180), "transform": src.transform, "nodata": NODATA,
                   "tiled": True, "blockxsize": 256, "blockysize": 256, "compress": "deflate", "predictor": 3}
    tmp = dst_path.with_suffix(".tmp.tif")
    with rasterio.open(tmp, "w", **profile) as dst:
        dst.write(data, 1)
    os.replace(tmp, dst_path)


async def ensure_sheet(client: httpx.AsyncClient, sheet: Sheet) -> Path:
    """Lokalny GeoTIFF arkusza; pobiera i konwertuje tylko przy pierwszym użyciu."""
    path = sheet.tif_path
    if path.exists():
        return path
    lock = _locks.setdefault(sheet.url, asyncio.Lock())
    async with lock:   # dwie działki z tego samego arkusza nie pobierają go dwa razy
        if path.exists():
            return path
        SHEETS_DIR.mkdir(parents=True, exist_ok=True)
        suffix = Path(sheet.url.split("?")[0]).suffix or ".asc"
        fd, raw_name = tempfile.mkstemp(suffix=suffix, dir=SHEETS_DIR)
        raw = Path(raw_name)
        try:
            with os.fdopen(fd, "wb") as out:
                async with client.stream("GET", sheet.url, timeout=DOWNLOAD_TIMEOUT_S) as response:
                    if response.status_code != 200:
                        raise SourceError(f"arkusz NMT {sheet.godlo}: HTTP {response.status_code} z opendata.geoportal.gov.pl")
                    async for chunk in response.aiter_bytes(1 << 20):
                        out.write(chunk)
            await asyncio.to_thread(_to_geotiff, raw, path)
        except httpx.TimeoutException as exc:
            raise SourceError(f"arkusz NMT {sheet.godlo} nie pobrał się w {DOWNLOAD_TIMEOUT_S:.0f} s") from exc
        except httpx.HTTPError as exc:
            raise SourceError(f"arkusz NMT {sheet.godlo}: błąd pobierania ({type(exc).__name__})") from exc
        except SourceError:
            raise
        except Exception as exc:   # rasterio/GDAL: uszkodzony albo nieznany plik
            raise SourceError(f"arkusz NMT {sheet.godlo} jest nieczytelny ({type(exc).__name__})") from exc
        finally:
            raw.unlink(missing_ok=True)
    return path


def read_window(paths: list[Path], bounds: tuple[int, int, int, int]):
    """Okno (wschód_min, północ_min, wschód_max, północ_max) z lokalnych arkuszy: (wysokości [m], transformacja)."""
    import rasterio
    from rasterio.merge import merge

    datasets = [rasterio.open(p) for p in paths]
    try:
        mosaic, transform = merge(datasets, bounds=bounds, nodata=NODATA)
    finally:
        for ds in datasets:
            ds.close()
    dem = mosaic[0].astype(float)
    dem[dem == NODATA] = np.nan
    dem[dem < -100] = np.nan
    return dem, transform


async def fetch_dem(client: httpx.AsyncClient, bounds: tuple[int, int, int, int]):
    """Wycinek NMT 1 m dla okna w EPSG:2180 jako (tablica wysokości [m], transformacja afiniczna rasterio)."""
    sheets = await find_sheets(client, bounds)
    paths = await asyncio.gather(*(ensure_sheet(client, sheet) for sheet in {s.url: s for s in sheets}.values()))
    try:
        dem, transform = await asyncio.to_thread(read_window, list(paths), bounds)
    except Exception as exc:
        raise SourceError(f"nie udało się wyciąć okna z arkuszy NMT ({type(exc).__name__})") from exc
    if dem.size == 0 or not np.isfinite(dem).any():
        raise NoData("Arkusze NMT nie mają danych wysokościowych dla tego miejsca.")
    return dem, transform
