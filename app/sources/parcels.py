"""Wyszukiwanie działki ewidencyjnej: wybór źródła, pamięć podręczna i pochodzenie wyniku w jednym miejscu.

Źródła (adaptery bez polityki):
- `uldk` — ULDK GUGiK, źródło podstawowe (identyfikator, punkt, wyszukiwanie po nazwie obrębu i numerze);
- `egib_wfs` — zbiorczy WFS ewidencji GUGiK, zapas przy awarii ULDK (identyfikator i punkt);
- PRG GUGiK (`egib_wfs.find_districts`) — tylko kody obrębów do wyszukiwania po nazwie, bez geometrii działek.

Polityka:
- ULDK najpierw; błąd ULDK (brak odpowiedzi, strona zastępcza, uszkodzony rekord lub geometria) → WFS EGiB.
  Odpowiedź ULDK „nie ma takiej działki” jest wynikiem, nie awarią, i nie uruchamia zapasu.
- Po awarii ULDK w wyszukiwaniu po nazwie kandydaci z PRG idą od razu do WFS EGiB, bez ponownych prób ULDK.
- Każdy wynik niesie `source` („uldk” albo „egib_wfs”), a pamięć podręczna (przestrzeń `uldk`) trzyma go razem z granicą.
"""
from __future__ import annotations

import asyncio
import re
from dataclasses import dataclass

import httpx
from pyproj import Geod
from shapely import wkt
from shapely.geometry import mapping
from shapely.geometry.base import BaseGeometry

from app import cache
from app.sources import NoData, SourceError, egib_wfs, uldk

CACHE_NS = "uldk"  # nazwa historyczna; wpisy z obu źródeł, z polem `source`
MAX_CANDIDATES = 50

# Pełny identyfikator: WWPPGG_R.OOOO[.AR_n].numer, np. 060910_2.0011.580/2
FULL_ID_RE = re.compile(r"^\d{6}_\d\.\d{4}\.(AR_\d+\.)?[0-9A-Za-z/._-]+$")
# Znaki dopuszczone w zapytaniu tekstowym (nazwa obrębu i numer działki).
QUERY_RE = re.compile(r"^[0-9A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż /._,-]{2,80}$")

_GEOD = Geod(ellps="GRS80")


@dataclass
class Parcel:
    id: str
    number: str | None
    region: str | None
    commune: str | None
    county: str | None
    voivodeship: str | None
    geometry: BaseGeometry  # EPSG:4326, kolejność lon, lat
    area_ha: float
    source: str = "uldk"  # "uldk" albo "egib_wfs" (zapasowa usługa WFS, gdy ULDK nie odpowiada)

    @property
    def centroid_lonlat(self) -> tuple[float, float]:
        c = self.geometry.centroid
        return (c.x, c.y)

    def geojson(self) -> dict:
        return mapping(self.geometry)


def is_full_id(text: str) -> bool:
    return bool(FULL_ID_RE.match(text.strip()))


def geodesic_area_ha(geometry: BaseGeometry) -> float:
    """Powierzchnia na elipsoidzie GRS80 [ha] dla geometrii w EPSG:4326."""
    area_m2, _ = _GEOD.geometry_area_perimeter(geometry)
    return abs(area_m2) / 10_000.0


def split_district_and_number(query: str) -> tuple[str, str] | None:
    """„Niedrzwica Kościelna 580/2” → („Niedrzwica Kościelna”, „580/2”). None, gdy brak numeru na końcu."""
    parts = query.replace(",", " ").split()
    if len(parts) < 2 or not parts[-1][0].isdigit():
        return None
    return " ".join(parts[:-1]), parts[-1]


# ---------- pamięć podręczna ----------

def _to_cache(p: Parcel) -> dict:
    return {"id": p.id, "number": p.number, "region": p.region, "commune": p.commune, "county": p.county,
            "voivodeship": p.voivodeship, "wkt": p.geometry.wkt, "area_ha": p.area_ha, "source": p.source}


def _from_cache(d: dict) -> Parcel:
    return Parcel(id=d["id"], number=d["number"], region=d["region"], commune=d["commune"], county=d["county"],
                  voivodeship=d["voivodeship"], geometry=wkt.loads(d["wkt"]), area_ha=d["area_ha"],
                  source=d.get("source", "uldk"))


def _remember(parcel: Parcel, *keys: str) -> None:
    for key in (*keys, f"id:{parcel.id}"):
        cache.put(CACHE_NS, key, _to_cache(parcel))


# ---------- wybór źródła ----------

def _parcel(record: dict, source: str) -> Parcel:
    geometry = record["geometry"]
    return Parcel(id=record["id"], number=record["number"], region=record["region"], commune=record["commune"],
                  county=record["county"], voivodeship=record["voivodeship"], geometry=geometry,
                  area_ha=geodesic_area_ha(geometry), source=source)


async def _from_fallback(uldk_error: Exception, fetch) -> Parcel:
    """Granica z WFS EGiB po awarii ULDK. `fetch` to niewywołana jeszcze korutyna adaptera egib_wfs."""
    try:
        record = await fetch
    except NoData:
        raise
    except (SourceError, RuntimeError) as exc:
        raise SourceError(f"{uldk_error}; zapasowa usługa WFS ewidencji też nie dała działki ({exc})") from exc
    return _parcel(record, "egib_wfs")


async def _resolve(primary, fallback) -> Parcel:
    """ULDK, a przy jego awarii (także uszkodzonym rekordzie) WFS EGiB. Korutyny są tworzone leniwie."""
    try:
        return _parcel(await primary(), "uldk")
    except NoData:
        raise
    except (SourceError, RuntimeError) as exc:
        return await _from_fallback(exc, fallback())


async def get_parcel_by_id(client: httpx.AsyncClient, parcel_id: str) -> tuple[Parcel, bool]:
    """Działka po pełnym identyfikatorze. Zwraca (działka, czy_z_cache)."""
    parcel_id = parcel_id.strip()
    if not is_full_id(parcel_id):
        raise NoData("To nie jest pełny identyfikator działki (wzór: 060910_2.0011.580/2).")
    cached = cache.get(CACHE_NS, f"id:{parcel_id}")
    if cached:
        return _from_cache(cached), True
    parcel = await _resolve(lambda: uldk.fetch_parcel_by_id(client, parcel_id),
                            lambda: egib_wfs.fetch_parcel_by_id(client, parcel_id))
    _remember(parcel)
    return parcel, False


async def get_parcel_by_point(client: httpx.AsyncClient, lon: float, lat: float) -> tuple[Parcel, bool]:
    """Działka zawierająca punkt (EPSG:4326, lon, lat). Zwraca (działka, czy_z_cache)."""
    key = f"xy:{lon:.6f},{lat:.6f}"
    cached = cache.get(CACHE_NS, key)
    if cached:
        return _from_cache(cached), True
    parcel = await _resolve(lambda: uldk.fetch_parcel_by_point(client, lon, lat),
                            lambda: egib_wfs.fetch_parcel_by_point(client, lon, lat))
    _remember(parcel, key)
    return parcel, False


async def _get_parcel_by_id_without_uldk(client: httpx.AsyncClient, parcel_id: str,
                                         uldk_error: Exception) -> Parcel:
    """Działka po identyfikatorze, gdy ULDK już zawiodło w tym zapytaniu: cache albo od razu WFS EGiB."""
    cached = cache.get(CACHE_NS, f"id:{parcel_id}")
    if cached:
        return _from_cache(cached)
    parcel = await _from_fallback(uldk_error, egib_wfs.fetch_parcel_by_id(client, parcel_id))
    _remember(parcel)
    return parcel


# ---------- wyszukiwanie po opisie ----------

def _candidate(p: Parcel) -> dict[str, str | None]:
    return {"id": p.id, "voivodeship": p.voivodeship, "county": p.county, "commune": p.commune,
            "region": p.region, "number": p.number}


async def search_parcels(client: httpx.AsyncClient, query: str) -> tuple[list[dict[str, str | None]], bool]:
    """Szukanie po „nazwa obrębu numer” albo po identyfikatorze. Zwraca (kandydaci, czy_ucięto_listę)."""
    query = " ".join(query.split())
    if not QUERY_RE.match(query):
        raise NoData("Wpisz nazwę obrębu i numer działki, np. „Niedrzwica Kościelna 580/2”, albo pełny identyfikator.")
    try:
        candidates = await uldk.search(client, query)
    except NoData:
        raise
    except (SourceError, RuntimeError) as exc:
        return await _search_without_uldk(client, query, exc)
    return candidates[:MAX_CANDIDATES], len(candidates) > MAX_CANDIDATES


async def _search_without_uldk(client: httpx.AsyncClient, query: str,
                               uldk_error: Exception) -> tuple[list[dict[str, str | None]], bool]:
    """Wyszukiwanie przy awarii ULDK: pełny identyfikator albo nazwa obrębu (PRG) + numer → WFS EGiB."""
    if is_full_id(query):
        return [_candidate(await _get_parcel_by_id_without_uldk(client, query, uldk_error))], False
    split = split_district_and_number(query)
    if split is None:
        raise SourceError(f"{uldk_error}. Wpisz nazwę obrębu i numer działki, pełny identyfikator "
                          "albo kliknij działkę na mapie.")
    name, number = split
    try:
        districts = await egib_wfs.find_districts(client, name)
    except (SourceError, RuntimeError) as exc:
        raise SourceError(f"{uldk_error}; zapasowe wyszukiwanie obrębu w PRG GUGiK też zawiodło ({exc})") from exc
    if not districts:
        raise NoData(f"Nie znaleziono obrębu „{name}” (wyszukiwanie zapasowe przy awarii ULDK). "
                     "Sprawdź nazwę obrębu albo kliknij działkę na mapie.")
    ids = [f"{code}.{number}" for code, _ in districts[:egib_wfs.MAX_DISTRICTS]]
    results = await asyncio.gather(*(_get_parcel_by_id_without_uldk(client, pid, uldk_error) for pid in ids),
                                   return_exceptions=True)
    candidates = [_candidate(r) for r in results if isinstance(r, Parcel)]
    if not candidates:
        errors = [r for r in results if isinstance(r, SourceError)]
        if errors:
            raise errors[0]
        return [], False
    return candidates, len(districts) > egib_wfs.MAX_DISTRICTS
