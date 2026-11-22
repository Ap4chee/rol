"""Sentinel-2 L2A przez Earth Search STAC: mediana NDVI i NDMI po pikselach z roślinnością na działce.

Zasady jak w specyfikacji modelu ML (docs/ml/specyfikacja_treningu.md, rozdz. 3):
- piksele liczone po środkach (`all_touched=False`), ważne tylko te z klasą SCL 4 (roślinność),
- progi: co najmniej 6 pikseli i 65% pokrycia działki,
- reflektancja = DN · scale + offset, a skala i offset pochodzą z `raster:bands` sceny
  (sprawdzone 21.11.2026: kolekcja `sentinel-2-c1-l2a` ma offset −0,1; starsze sceny w `sentinel-2-l2a` offset 0),
- wyjątek: w `sentinel-2-l2a` sceny z bazą przetwarzania od 04.00 (2022 i ponownie przetworzone starsze) mają
  przesunięcie 1000 DN już odjęte w pikselach, choć `raster:bands` nadal podaje offset −0,1. Dla tej kolekcji
  offset = 0. Flaga `earthsearch:boa_offset_applied` tego nie rozstrzyga: z 1570 scen z 2022 r. (70 obszarów
  w Polsce) 92 miały `false`, a ich piksele też były już po korekcie (91 z 92 dawało reflektancję o 0,1 za niską).
  Sprawdzone 22.11.2026 na tej samej scenie w obu kolekcjach (`scripts/checks/check_sentinel_offset.py`, 3.06.2023,
  kafel 34UEB: B8A 5108 DN w c1 i 4108 DN w l2a) oraz na sąsiednich kaflach tego samego przelotu (10.05.2022:
  B11 1911 DN z flagą `false` i 1908 DN z flagą `true`). Bez tego NDMI wychodzi zawyżone o ok. 0,2, a NDVI
  zwykle nie powstaje (czerwień ujemna),
- NDMI = (B8A − B11) / (B8A + B11), NDVI = (B8A − B04) / (B8A + B04); B04 uśredniane z 10 m do siatki 20 m.

Kolekcja `sentinel-2-c1-l2a` nie ma wszystkich starszych scen (czerwiec–lipiec 2018 nad Lubelszczyzną:
8 dat wobec 12 w `sentinel-2-l2a`), więc przeszukujemy obie i łączymy po satelicie i czasie zdjęcia.
Geometria jest przeliczana do układu każdej sceny (Polska leży w strefach UTM 33 i 34).

Szybkość. Sceny leżą w zasobniku AWS us-west-2. Zmierzone 21.11.2026 z sieci hackathonu: ok. 20 kB/s
na połączenie i ok. 150 kB/s łącznie, a blok pasma z działką ma 0,4 MB (20 m) albo 1,6 MB (10 m).
Dlatego:
- najpierw czytamy maski SCL wszystkich scen (małe bloki), pasma tylko dla najwyżej trzech czystych scen,
- blok rastra pobieramy własnymi równoległymi zapytaniami zakresowymi (4 razy szybciej niż odczyt GDAL
  jednym połączeniem; dekodowanie DEFLATE z predyktorem 2 daje wynik identyczny z GDAL),
- każda obserwacja trafia do pamięci podręcznej po działce i scenie od razu po wczytaniu, a pobieranie
  rozpoczęte przed upływem limitu czasu kończy się w tle, więc kolejne wywołanie zastaje gotowe wyniki.

Funkcje są blokujące i importowalne poza aplikacją; aplikacja uruchamia je w wątku.
"""
from __future__ import annotations

import hashlib
import math
import threading
import time
import warnings
import zlib
from concurrent.futures import Future, ThreadPoolExecutor, wait
from dataclasses import asdict, dataclass, field
from datetime import date, datetime, timedelta

import httpx
import numpy as np
from shapely.geometry import mapping
from shapely.geometry.base import BaseGeometry

from app.config import USER_AGENT, check_forced_failure
from app.infra import cache
from app.infra.geo import reproject
from app.sources import SourceError

STAC_URL = "https://earth-search.aws.element84.com/v1"
COLLECTIONS = ("sentinel-2-c1-l2a", "sentinel-2-l2a")  # pierwsza ma pierwszeństwo przy tej samej scenie
OFFSET_APPLIED_COLLECTION = "sentinel-2-l2a"   # piksele tej kolekcji są już po odjęciu przesunięcia reflektancji
ASSETS = ("nir08", "swir16", "red", "scl")
# Wersja wpisów w pamięci podręcznej (lista scen i obserwacje). Zmiana sposobu liczenia reflektancji = nowa wersja,
# żeby stare wpisy z błędnym offsetem nie wróciły do raportu.
CACHE_VERSION = "v3"   # v2: poprawka offsetu; v3: mediany pasm w obserwacji
WINDOW_DAYS = 45
MIN_PIXELS = 6
MIN_COVERAGE = 0.65
SCL_VEGETATION = 4
SCL_BARE_SOIL = 5
SCL_CLOUDY = (3, 8, 9, 10)   # cień chmur, chmury, cirrus
MAX_BAND_SCENES = 3          # wskaźniki liczymy dla najnowszej czystej sceny i dwóch wcześniejszych
MIN_SCENE_SPACING_DAYS = 7   # ...oddalonych od siebie co najmniej o tyle dni (do oceny zmiany w czasie)
SCENE_WORKERS = 16
RANGE_WORKERS = 48
RANGE_CHUNK_BYTES = 32 * 1024
PENDING_REASON = "wskaźniki jeszcze się wczytują"
SKIPPED_REASON = (f"czysta scena, wskaźników nie liczono (bierzemy {MAX_BAND_SCENES} sceny "
                  f"w odstępach co najmniej {MIN_SCENE_SPACING_DAYS} dni)")
GDAL_OPTIONS = {
    "GDAL_DISABLE_READDIR_ON_OPEN": "EMPTY_DIR",
    "CPL_VSIL_CURL_ALLOWED_EXTENSIONS": ".tif",
    "GDAL_HTTP_MERGE_CONSECUTIVE_RANGES": "YES",
    "GDAL_HTTP_TIMEOUT": "60",
    "GDAL_HTTP_MAX_RETRY": "1",
}

# Maskę działki rasteryzujemy na tablicy w pamięci; rasterio ostrzega wtedy o braku georeferencji pliku,
# choć transformację podajemy jawnie.
try:
    from rasterio.errors import NotGeoreferencedWarning
    warnings.filterwarnings("ignore", category=NotGeoreferencedWarning)
except ImportError:  # starsze wersje rasterio
    pass

_client = None
_client_lock = threading.Lock()
_scene_pool = ThreadPoolExecutor(max_workers=SCENE_WORKERS, thread_name_prefix="s2-scene")
_band_pool = ThreadPoolExecutor(max_workers=3 * MAX_BAND_SCENES * 2, thread_name_prefix="s2-band")
_range_pool = ThreadPoolExecutor(max_workers=RANGE_WORKERS, thread_name_prefix="s2-range")
_http = httpx.Client(timeout=httpx.Timeout(25.0, connect=10.0), headers={"User-Agent": USER_AGENT},
                     limits=httpx.Limits(max_connections=RANGE_WORKERS, max_keepalive_connections=RANGE_WORKERS))
_inflight: dict[str, Future] = {}
_inflight_lock = threading.Lock()


@dataclass
class Scene:
    id: str
    collection: str
    acquired: str            # ISO, UTC
    platform: str
    hrefs: dict[str, str]
    scale: dict[str, float]  # dla pasm: skala reflektancji z raster:bands
    offset: dict[str, float]
    nodata: dict[str, float]

    @property
    def day(self) -> date:
        return datetime.fromisoformat(self.acquired.replace("Z", "+00:00")).date()

    @property
    def tile(self) -> str:
        """Kafel MGRS z identyfikatora sceny, np. 34UEB (oba formaty: S2A_T34UEB_... i S2B_34UEB_...)."""
        for part in self.id.split("_"):
            if len(part) in (5, 6) and part[-5:-3].isdigit() and part[-3:].isalpha():
                return part[-5:]
        return ""

    @property
    def pass_key(self) -> tuple[str, str]:
        """Jeden przelot satelity nad działką: satelita i dzień (ten sam przelot bywa w dwóch kaflach i kolekcjach)."""
        return self.platform, self.day.isoformat()


@dataclass
class Observation:
    scene_id: str
    date: str
    collection: str
    total_pixels: int
    valid_pixels: int        # piksele z roślinnością (SCL 4)
    bare_pixels: int = 0     # goła gleba (SCL 5)
    cloudy_pixels: int = 0
    accepted: bool = False   # scena przeszła próg pikseli i pokrycia
    reject_reason: str | None = None
    ndvi: float | None = None
    ndmi: float | None = None
    # mediany reflektancji po pikselach z roślinnością (cechy modelu prognozy NDMI, kowr_ml/features.py)
    nir08: float | None = None
    swir16: float | None = None
    red: float | None = None

    @property
    def coverage(self) -> float:
        return self.valid_pixels / self.total_pixels if self.total_pixels else 0.0


@dataclass
class SatelliteResult:
    window_from: date
    window_to: date
    scenes_found: int
    observations: list[Observation]
    timings_s: dict[str, float] = field(default_factory=dict)
    cached_observations: int = 0
    unfinished: int = 0      # sceny, których wczytywanie trwa jeszcze w tle
    notes: list[str] = field(default_factory=list)


# ---------- wyszukiwanie scen ----------

def _stac_client():
    global _client
    with _client_lock:
        if _client is None:
            from pystac_client import Client
            _client = Client.open(STAC_URL)
        return _client


def _scene_from_item(item, collection: str) -> Scene | None:
    hrefs, scale, offset, nodata = {}, {}, {}, {}
    # Przesunięcie reflektancji już odjęte w pikselach (patrz opis modułu): nie odejmujemy go drugi raz.
    # W `sentinel-2-l2a` dotyczy to każdej sceny, także gdy flaga w metadanych mówi inaczej.
    offset_applied = collection == OFFSET_APPLIED_COLLECTION or bool(item.properties.get("earthsearch:boa_offset_applied"))
    for key in ASSETS:
        asset = item.assets.get(key)
        if asset is None:
            return None
        hrefs[key] = asset.href
        bands = asset.extra_fields.get("raster:bands") or [{}]
        nodata[key] = float(bands[0].get("nodata", 0) or 0)
        if key != "scl":
            if "scale" not in bands[0]:
                return None  # bez skali z metadanych nie zgadujemy reflektancji
            scale[key] = float(bands[0]["scale"])
            offset[key] = 0.0 if offset_applied else float(bands[0].get("offset", 0.0) or 0.0)
    acquired = item.properties.get("datetime")
    if not acquired:
        return None
    return Scene(item.id, collection, acquired, str(item.properties.get("platform", "")), hrefs, scale, offset, nodata)


def search_scenes(geometry: BaseGeometry, start: date, end: date, today: date | None = None) -> list[Scene]:
    """Sceny Sentinel-2 L2A przecinające geometrię (EPSG:4326) z dni [start, end], bez powtórzeń między kolekcjami."""
    digest = hashlib.sha1(geometry.wkt.encode()).hexdigest()[:16]
    key = f"search:{CACHE_VERSION}:{digest}:{start}:{end}"
    settled = today is not None and (today - end).days > 10  # po kilku dniach lista scen dla okna już się nie zmienia
    cached = cache.get("sentinel", key, max_age_s=None if settled else 3600.0)
    if cached is not None:
        return [Scene(**s) for s in cached]
    check_forced_failure("satellite")
    window = f"{start.isoformat()}T00:00:00Z/{end.isoformat()}T23:59:59Z"

    def one(collection: str) -> list[Scene]:
        search = _stac_client().search(collections=[collection], intersects=mapping(geometry), datetime=window, limit=100)
        return [s for s in (_scene_from_item(item, collection) for item in search.items()) if s is not None]

    try:
        with ThreadPoolExecutor(max_workers=len(COLLECTIONS)) as pool:
            per_collection = list(pool.map(one, COLLECTIONS))
    except Exception as exc:  # pystac-client zgłasza różne wyjątki sieciowe
        raise SourceError(f"Earth Search STAC nie odpowiedział ({type(exc).__name__})") from exc
    # Ta sama scena bywa w obu kolekcjach z różnym identyfikatorem i czasem: łączymy po satelicie, dniu i kaflu.
    merged: dict[tuple[str, str, str], Scene] = {}
    for scenes in per_collection:          # kolejność COLLECTIONS = pierwszeństwo
        for scene in scenes:
            merged.setdefault((*scene.pass_key, scene.tile), scene)
    out = sorted(merged.values(), key=lambda s: s.acquired)
    cache.put("sentinel", key, [asdict(s) for s in out])
    return out


# ---------- odczyt wycinka rastra ----------

def _fetch_range(href: str, start: int, end: int) -> bytes:
    last = "brak odpowiedzi"
    for _attempt in range(3):
        try:
            response = _http.get(href, headers={"Range": f"bytes={start}-{end}"})
            if response.status_code == 206 and len(response.content) == end - start + 1:
                return response.content
            last = f"HTTP {response.status_code}"
        except httpx.HTTPError as exc:
            last = type(exc).__name__
    raise SourceError(f"nie udało się pobrać fragmentu sceny ({last})")


def _fetch_bytes(href: str, offset: int, size: int) -> bytes:
    """Fragment pliku pobrany równoległymi zapytaniami zakresowymi."""
    ranges = [(offset + i, min(offset + i + RANGE_CHUNK_BYTES, offset + size) - 1)
              for i in range(0, size, RANGE_CHUNK_BYTES)]
    futures = [_range_pool.submit(_fetch_range, href, a, b) for a, b in ranges]
    return b"".join(f.result() for f in futures)


def _read_block(ds, href: str, bx: int, by: int) -> np.ndarray | None:
    """Jeden blok COG pobrany równolegle i zdekodowany. None = format nieobsługiwany (wtedy czyta GDAL)."""
    structure = ds.tags(ns="IMAGE_STRUCTURE")
    predictor = structure.get("PREDICTOR", "1")
    dtype = ds.dtypes[0]
    if structure.get("COMPRESSION") != "DEFLATE" or predictor not in ("1", "2") or dtype not in ("uint8", "uint16"):
        return None
    offset = ds.get_tag_item(f"BLOCK_OFFSET_{bx}_{by}", "TIFF", bidx=1)
    size = ds.get_tag_item(f"BLOCK_SIZE_{bx}_{by}", "TIFF", bidx=1)
    if offset is None or size is None:
        return None
    block_h, block_w = ds.block_shapes[0]
    if int(size) == 0:   # blok pusty (poza zasięgiem zdjęcia)
        return np.zeros((block_h, block_w), dtype=dtype)
    raw = zlib.decompress(_fetch_bytes(href, int(offset), int(size)))
    np_dtype = np.dtype(dtype).newbyteorder("<")
    if len(raw) != block_h * block_w * np_dtype.itemsize:
        return None
    block = np.frombuffer(raw, dtype=np_dtype).reshape(block_h, block_w)
    if predictor == "2":   # różnicowanie poziome: odtworzenie sumą narastającą w wierszu
        block = np.cumsum(block, axis=1, dtype=np_dtype)
    return block


def _read_grid(ds, href: str, bounds: tuple[float, float, float, float], shape: tuple[int, int]) -> np.ndarray:
    """Surowe wartości pikseli dla siatki o zadanym zasięgu i kształcie (wiersze, kolumny).

    Zasięg jest wyrównany do siatki 20 m. Pasmo 10 m zwraca tablicę dwukrotnie gęstszą (uśredniamy ją później).
    Piksele poza sceną dostają 0, czyli brak danych.
    """
    from rasterio.windows import Window

    res = ds.transform.a
    factor = max(int(round((bounds[2] - bounds[0]) / shape[1] / res)), 1)
    col_off = int(round((bounds[0] - ds.transform.c) / res))
    row_off = int(round((ds.transform.f - bounds[3]) / res))
    height, width = shape[0] * factor, shape[1] * factor
    out = np.zeros((height, width), dtype=float)
    c0, r0 = max(col_off, 0), max(row_off, 0)
    c1, r1 = min(col_off + width, ds.width), min(row_off + height, ds.height)
    if c1 <= c0 or r1 <= r0:
        return out
    block_h, block_w = ds.block_shapes[0]
    blocks: dict[tuple[int, int], np.ndarray | None] = {}
    for by in range(r0 // block_h, (r1 - 1) // block_h + 1):
        for bx in range(c0 // block_w, (c1 - 1) // block_w + 1):
            blocks[(bx, by)] = _read_block(ds, href, bx, by)
    if any(block is None for block in blocks.values()):
        out[r0 - row_off:r1 - row_off, c0 - col_off:c1 - col_off] = ds.read(1, window=Window(c0, r0, c1 - c0, r1 - r0))
        return out
    for (bx, by), block in blocks.items():
        # część wspólna bloku i okna, w pikselach rastra
        x0, y0 = max(c0, bx * block_w), max(r0, by * block_h)
        x1, y1 = min(c1, (bx + 1) * block_w), min(r1, (by + 1) * block_h)
        out[y0 - row_off:y1 - row_off, x0 - col_off:x1 - col_off] = block[
            y0 - by * block_h:y1 - by * block_h, x0 - bx * block_w:x1 - bx * block_w]
    return out


def _grid_and_mask(ds, geometry_4326: BaseGeometry):
    """Zasięg siatki 20 m obejmującej działkę i maska pikseli, których środki leżą w działce (układ sceny)."""
    from rasterio.features import geometry_mask
    from rasterio.transform import from_origin

    geom = reproject(geometry_4326, "EPSG:4326", ds.crs.to_string())
    minx, miny, maxx, maxy = geom.bounds
    res = ds.transform.a
    x0, y0 = ds.transform.c, ds.transform.f
    col_off = math.floor((minx - x0) / res)
    row_off = math.floor((y0 - maxy) / res)
    width = max(math.ceil((maxx - x0) / res) - col_off, 1)
    height = max(math.ceil((y0 - miny) / res) - row_off, 1)
    left, top = x0 + col_off * res, y0 - row_off * res
    inside = geometry_mask([mapping(geom)], out_shape=(height, width), transform=from_origin(left, top, res, res),
                           invert=True, all_touched=False)
    return inside, (left, top - height * res, left + width * res, top)


def read_scl(scene: Scene, geometry_4326: BaseGeometry) -> tuple[Observation, dict]:
    """Klasy SCL na działce: liczba pikseli ogółem, z roślinnością, gołej gleby, zachmurzonych."""
    import rasterio

    with rasterio.Env(**GDAL_OPTIONS), rasterio.open(scene.hrefs["scl"]) as ds:
        inside, bounds = _grid_and_mask(ds, geometry_4326)
        scl = _read_grid(ds, scene.hrefs["scl"], bounds, inside.shape)
    total = int(inside.sum())
    vegetation = inside & (scl == SCL_VEGETATION)
    obs = Observation(
        scene_id=scene.id, date=scene.day.isoformat(), collection=scene.collection, total_pixels=total,
        valid_pixels=int(vegetation.sum()), bare_pixels=int((inside & (scl == SCL_BARE_SOIL)).sum()),
        cloudy_pixels=int((inside & np.isin(scl, SCL_CLOUDY)).sum()))
    if total < MIN_PIXELS:
        obs.reject_reason = f"działka mieści tylko {total} środków pikseli 20 m (potrzeba co najmniej {MIN_PIXELS})"
    elif obs.valid_pixels >= MIN_PIXELS and obs.coverage >= MIN_COVERAGE:
        obs.accepted = True
    elif obs.cloudy_pixels >= obs.bare_pixels and obs.cloudy_pixels > 0:
        obs.reject_reason = "chmury albo ich cień nad działką"
    elif obs.bare_pixels > 0 and obs.bare_pixels + obs.valid_pixels >= MIN_COVERAGE * total:
        obs.reject_reason = "brak zielonej roślinności (odkryta gleba, resztki albo zaschnięte, dojrzałe rośliny)"
    else:
        obs.reject_reason = "za mało czystych pikseli z roślinnością"
    return obs, {"vegetation": vegetation, "bounds": bounds}


def read_indices(scene: Scene, obs: Observation, context: dict) -> Observation:
    """Mediana NDVI i NDMI po pikselach z roślinnością. Uzupełnia przekazaną obserwację."""
    import rasterio

    vegetation = context["vegetation"]
    shape = vegetation.shape

    def band(key: str) -> np.ndarray:
        with rasterio.Env(**GDAL_OPTIONS), rasterio.open(scene.hrefs[key]) as ds:
            dn = _read_grid(ds, scene.hrefs[key], context["bounds"], shape)
        value = dn * scene.scale[key] + scene.offset[key]
        value[dn == scene.nodata[key]] = np.nan
        factor = value.shape[0] // shape[0]
        if factor > 1:  # pasmo 10 m: średnia z bloków 2 × 2 (brak danych w bloku unieważnia piksel 20 m)
            value = value.reshape(shape[0], factor, shape[1], factor).mean(axis=(1, 3))
        return value

    def median_index(a: np.ndarray, b: np.ndarray) -> float | None:
        ok = vegetation & np.isfinite(a) & np.isfinite(b) & (a >= 0) & (b >= 0) & ((a + b) > 1e-6)
        if ok.sum() < MIN_PIXELS:
            return None
        return float(np.median((a[ok] - b[ok]) / (a[ok] + b[ok])))

    # osobna pula wątków: zadanie sceny czeka tu na trzy pasma i nie może blokować własnej puli
    futures = {key: _band_pool.submit(band, key) for key in ("nir08", "swir16", "red")}
    nir, swir = futures["nir08"].result(), futures["swir16"].result()
    obs.ndmi = median_index(nir, swir)
    used = vegetation & np.isfinite(nir) & np.isfinite(swir) & (nir >= 0) & (swir >= 0) & ((nir + swir) > 1e-6)
    if obs.ndmi is not None:
        obs.nir08, obs.swir16 = float(np.median(nir[used])), float(np.median(swir[used]))
    try:
        red = futures["red"].result()
        obs.ndvi = median_index(nir, red)
        used_red = used & np.isfinite(red) & (red >= 0) & ((nir + red) > 1e-6)
        if obs.ndvi is not None and used_red.sum() >= MIN_PIXELS:
            obs.red = float(np.median(red[used_red]))
    except Exception:   # brak NDVI nie unieważnia NDMI
        obs.ndvi = None
    if obs.ndmi is None:
        obs.accepted = False
        obs.reject_reason = "za mało pikseli z poprawną reflektancją"
    return obs


# ---------- zadania w tle i pamięć podręczna po działce i scenie ----------

def _obs_key(parcel_key: str, scene_id: str) -> str:
    return f"obs:{CACHE_VERSION}:{parcel_key}:{scene_id}"


def _submit(key: str, fn, *args) -> Future:
    """Uruchamia zadanie albo zwraca już trwające o tym samym kluczu (bez podwójnego pobierania)."""
    with _inflight_lock:
        future = _inflight.get(key)
        if future is None or (future.done() and future.exception() is not None):
            future = _scene_pool.submit(fn, *args)
            _inflight[key] = future
            future.add_done_callback(lambda done, k=key: _forget(k, done))
        return future


def _forget(key: str, future: Future) -> None:
    with _inflight_lock:
        if _inflight.get(key) is future and future.exception() is None:
            _inflight.pop(key, None)


def _scl_job(parcel_key: str, scene: Scene, geometry: BaseGeometry) -> tuple[Observation, dict]:
    obs, context = read_scl(scene, geometry)
    cache.put("sentinel", _obs_key(parcel_key, scene.id), asdict(obs))
    return obs, context


def _bands_job(parcel_key: str, scene: Scene, geometry: BaseGeometry) -> Observation:
    obs, context = read_scl(scene, geometry)   # maska roślinności; blok SCL jest mały
    if obs.accepted:
        read_indices(scene, obs, context)
    cache.put("sentinel", _obs_key(parcel_key, scene.id), asdict(obs))
    return obs


def choose_for_indices(accepted: list[Observation]) -> list[Observation]:
    """Najnowsza czysta scena i wcześniejsze, każda co najmniej 7 dni przed poprzednio wybraną (łącznie do 3)."""
    chosen: list[Observation] = []
    for obs in sorted(accepted, key=lambda o: (o.date, o.scene_id), reverse=True):
        if not chosen or (date.fromisoformat(chosen[-1].date) - date.fromisoformat(obs.date)).days >= MIN_SCENE_SPACING_DAYS:
            chosen.append(obs)
        if len(chosen) == MAX_BAND_SCENES:
            break
    return chosen


def observe(parcel_key: str, geometry: BaseGeometry, day: date, today: date | None = None,
            budget_s: float = 20.0) -> SatelliteResult:
    """Obserwacje z okna [day − 45 dni, day]. Nigdy nie sięga po sceny późniejsze niż `day`.

    parcel_key – stały identyfikator działki do pamięci podręcznej obserwacji (po działce i scenie)
    budget_s   – ile czekamy na wynik; niedokończone pobierania trwają w tle i trafiają do pamięci
                 podręcznej, a w wyniku są policzone w `unfinished`
    """
    deadline = time.perf_counter() + budget_s
    start = day - timedelta(days=WINDOW_DAYS)
    t0 = time.perf_counter()
    scenes = search_scenes(geometry, start, day, today)
    result = SatelliteResult(window_from=start, window_to=day, scenes_found=len(scenes), observations=[])
    result.timings_s["search"] = round(time.perf_counter() - t0, 2)
    if not scenes:
        return result
    by_id = {scene.id: scene for scene in scenes}

    # etap 1: maski SCL wszystkich scen
    t0 = time.perf_counter()
    done: dict[str, Observation] = {}
    scl_futures: dict[Future, Scene] = {}
    for scene in scenes:
        cached = cache.get("sentinel", _obs_key(parcel_key, scene.id))
        if cached:
            done[scene.id] = Observation(**cached)
        else:
            scl_futures[_submit(f"scl:{parcel_key}:{scene.id}", _scl_job, parcel_key, scene, geometry)] = scene
    result.cached_observations = len(done)
    finished, not_finished = wait(scl_futures, timeout=max(deadline - time.perf_counter(), 0.05))
    failed = 0
    for future in finished:
        try:
            done[scl_futures[future].id] = future.result()[0]
        except Exception:
            failed += 1
    if failed:
        result.notes.append(f"Nie udało się odczytać {failed} scen (błąd pobierania wycinka).")
    result.unfinished = len(not_finished)
    result.timings_s["scl"] = round(time.perf_counter() - t0, 2)

    # ta sama scena z dwóch kafli albo kolekcji: zostaje ta z lepszym pokryciem
    best: dict[tuple[str, str], Observation] = {}
    for obs in done.values():
        key = by_id[obs.scene_id].pass_key
        current = best.get(key)
        if current is None or (obs.accepted, obs.valid_pixels) > (current.accepted, current.valid_pixels):
            best[key] = obs
    observations = sorted(best.values(), key=lambda o: (o.date, o.scene_id))

    # etap 2: pasma dla wybranych czystych scen, od najnowszej
    t0 = time.perf_counter()
    accepted = [o for o in observations if o.accepted]
    chosen = choose_for_indices(accepted)
    chosen_ids = {o.scene_id for o in chosen}
    band_futures: dict[Future, Observation] = {}
    for obs in chosen:
        if obs.ndmi is None:
            band_futures[_submit(f"bands:{parcel_key}:{obs.scene_id}", _bands_job, parcel_key,
                                 by_id[obs.scene_id], geometry)] = obs
    finished, not_finished = wait(band_futures, timeout=max(deadline - time.perf_counter(), 0.05))
    replaced: dict[str, Observation] = {}
    for future in finished:
        obs = band_futures[future]
        try:
            replaced[obs.scene_id] = future.result()
        except Exception as exc:
            obs.accepted = False
            obs.reject_reason = f"błąd odczytu pasm ({type(exc).__name__})"
    pending_ids = {band_futures[future].scene_id for future in not_finished}
    result.unfinished += len(pending_ids)
    result.timings_s["bands"] = round(time.perf_counter() - t0, 2)

    final: list[Observation] = []
    for obs in observations:
        obs = replaced.get(obs.scene_id, obs)
        if obs.accepted and obs.scene_id in pending_ids:
            obs = Observation(**{**asdict(obs), "accepted": False, "reject_reason": PENDING_REASON})
        elif obs.accepted and obs.scene_id not in chosen_ids:
            obs = Observation(**{**asdict(obs), "accepted": False, "reject_reason": SKIPPED_REASON})
        final.append(obs)
    result.observations = final
    return result
