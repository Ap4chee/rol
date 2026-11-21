"""Działka ewidencyjna z usługi ULDK GUGiK (https://uldk.gugik.gov.pl).

Sprawdzone prawdziwymi wywołaniami 21.11.2026:
- GetParcelById i GetParcelByXY: pierwsza linia `0` = sukces, `-1 ...` = brak wyników.
- GetParcelByIdOrNr: pierwsza linia to liczba trafień.
- Zdarza się strona HTML „Request Rejected”: odpowiedź, która nie zaczyna się od cyfry
  (ani od `-1`), traktujemy jako błąd i ponawiamy raz.
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
from app.config import TIMEOUT_ULDK_S, check_forced_failure
from app.sources import NoData, SourceError, egib_wfs

ULDK_URL = "https://uldk.gugik.gov.pl/"
RESULT_FIELDS = "teryt,voivodeship,county,commune,region,parcel"
MAX_CANDIDATES = 50
# 21.11.2026 wieczorem ULDK (i inne usługi integracja.gugik.gov.pl) odpowiadały na każde zapytanie, z różnych
# adresów IP, przekierowaniem 302 na integracja01.gugik.gov.pl/resp/uldk.php: strona zastępcza na czas awarii.
UNAVAILABLE_MESSAGE = ("Usługa działek GUGiK (ULDK) jest chwilowo niedostępna – serwer GUGiK przekierowuje wszystkie "
                       "zapytania na stronę zastępczą (awaria po stronie GUGiK)")

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


async def _request(client: httpx.AsyncClient, params: dict[str, str]) -> list[str]:
    """Wywołuje ULDK i zwraca niepuste linie odpowiedzi. Ponawia raz przy błędzie lub odpowiedzi nie-ULDK."""
    check_forced_failure("uldk")
    last_error = "brak odpowiedzi"
    for _attempt in range(2):
        try:
            # Bez podążania za przekierowaniem: strona zastępcza GUGiK odpowiada udawanym „0” i nieczytelną treścią.
            response = await client.get(ULDK_URL, params=params, timeout=TIMEOUT_ULDK_S, follow_redirects=False)
        except httpx.HTTPError as exc:
            last_error = f"błąd połączenia: {type(exc).__name__}"
            continue
        if response.is_redirect and "/resp/" in response.headers.get("location", ""):
            raise SourceError(UNAVAILABLE_MESSAGE)
        if response.status_code != 200:
            last_error = f"HTTP {response.status_code}"
            continue
        text = response.content.decode("utf-8", errors="replace").strip()
        lines = [line.strip() for line in text.splitlines() if line.strip()]
        if lines and (lines[0][0].isdigit() or lines[0].startswith("-1")):
            return lines
        last_error = "odpowiedź nie pochodzi z ULDK (np. strona „Request Rejected”)"
    raise SourceError(f"ULDK nie odpowiedziało poprawnie: {last_error}")


def _parse_fields(line: str) -> dict[str, str | None]:
    parts = line.split("|")
    names = ["id", "voivodeship", "county", "commune", "region", "number"]
    return {name: (parts[i].strip() or None) if i < len(parts) else None for i, name in enumerate(names)}


def _parse_parcel(line: str) -> Parcel:
    parts = line.split("|")
    if len(parts) < 7:
        raise SourceError("ULDK zwróciło niepełny rekord działki")
    fields = _parse_fields(line)
    geom_text = parts[6].strip()
    if ";" in geom_text:  # "SRID=4326;POLYGON((...))"
        geom_text = geom_text.split(";", 1)[1]
    try:
        geometry = wkt.loads(geom_text)
    except Exception as exc:  # shapely zgłasza różne typy wyjątków zależnie od wersji
        raise SourceError("ULDK zwróciło nieczytelną geometrię działki") from exc
    if geometry.is_empty or geometry.geom_type not in ("Polygon", "MultiPolygon"):
        raise SourceError("ULDK zwróciło geometrię, która nie jest wielokątem")
    if not fields["id"]:
        raise SourceError("ULDK nie zwróciło identyfikatora działki")
    return Parcel(
        id=fields["id"], number=fields["number"], region=fields["region"], commune=fields["commune"],
        county=fields["county"], voivodeship=fields["voivodeship"],
        geometry=geometry, area_ha=geodesic_area_ha(geometry),
    )


def _parcel_to_cache(p: Parcel) -> dict:
    return {"id": p.id, "number": p.number, "region": p.region, "commune": p.commune, "county": p.county,
            "voivodeship": p.voivodeship, "wkt": p.geometry.wkt, "area_ha": p.area_ha, "source": p.source}


def _parcel_from_cache(d: dict) -> Parcel:
    return Parcel(id=d["id"], number=d["number"], region=d["region"], commune=d["commune"], county=d["county"],
                  voivodeship=d["voivodeship"], geometry=wkt.loads(d["wkt"]), area_ha=d["area_ha"],
                  source=d.get("source", "uldk"))


async def _from_egib_wfs(uldk_error: Exception, fetch) -> Parcel:
    """Granica z zapasowej usługi WFS EGiB, gdy ULDK zawiodło. `fetch` to oczekiwane wywołanie egib_wfs."""
    try:
        record = await fetch
    except NoData:
        raise
    except (SourceError, RuntimeError) as exc:
        raise SourceError(f"{uldk_error}; zapasowa usługa WFS ewidencji też nie dała działki ({exc})") from exc
    return Parcel(id=record["id"], number=record["number"], region=record["region"], commune=record["commune"],
                  county=record["county"], voivodeship=record["voivodeship"], geometry=record["geometry"],
                  area_ha=geodesic_area_ha(record["geometry"]), source="egib_wfs")


async def get_parcel_by_id(client: httpx.AsyncClient, parcel_id: str) -> tuple[Parcel, bool]:
    """Działka po pełnym identyfikatorze. Zwraca (działka, czy_z_cache)."""
    parcel_id = parcel_id.strip()
    if not is_full_id(parcel_id):
        raise NoData("To nie jest pełny identyfikator działki (wzór: 060910_2.0011.580/2).")
    cached = cache.get("uldk", f"id:{parcel_id}")
    if cached:
        return _parcel_from_cache(cached), True
    try:
        lines = await _request(client, {
            "request": "GetParcelById", "id": parcel_id,
            "result": RESULT_FIELDS + ",geom_wkt", "srid": "4326",
        })
    except (SourceError, RuntimeError) as exc:
        parcel = await _from_egib_wfs(exc, egib_wfs.fetch_parcel_by_id(client, parcel_id))
        cache.put("uldk", f"id:{parcel.id}", _parcel_to_cache(parcel))
        return parcel, False
    if lines[0].startswith("-1") or len(lines) < 2:
        raise NoData(f"ULDK nie zna działki o identyfikatorze {parcel_id}.")
    parcel = _parse_parcel(lines[1])
    cache.put("uldk", f"id:{parcel.id}", _parcel_to_cache(parcel))
    return parcel, False


async def get_parcel_by_point(client: httpx.AsyncClient, lon: float, lat: float) -> tuple[Parcel, bool]:
    """Działka zawierająca punkt (EPSG:4326). ULDK przyjmuje kolejność: długość, szerokość, układ."""
    key = f"xy:{lon:.6f},{lat:.6f}"
    cached = cache.get("uldk", key)
    if cached:
        return _parcel_from_cache(cached), True
    try:
        lines = await _request(client, {
            "request": "GetParcelByXY", "xy": f"{lon:.7f},{lat:.7f},4326",
            "result": RESULT_FIELDS + ",geom_wkt", "srid": "4326",
        })
    except (SourceError, RuntimeError) as exc:
        parcel = await _from_egib_wfs(exc, egib_wfs.fetch_parcel_by_point(client, lon, lat))
        cache.put("uldk", key, _parcel_to_cache(parcel))
        cache.put("uldk", f"id:{parcel.id}", _parcel_to_cache(parcel))
        return parcel, False
    if lines[0].startswith("-1") or len(lines) < 2:
        raise NoData("W tym punkcie ULDK nie zwraca działki ewidencyjnej (punkt poza Polską albo poza ewidencją).")
    parcel = _parse_parcel(lines[1])
    cache.put("uldk", key, _parcel_to_cache(parcel))
    cache.put("uldk", f"id:{parcel.id}", _parcel_to_cache(parcel))
    return parcel, False


async def search_parcels(client: httpx.AsyncClient, query: str) -> tuple[list[dict[str, str | None]], bool]:
    """Szukanie po „nazwa obrębu numer” albo po identyfikatorze. Zwraca (kandydaci, czy_ucięto_listę)."""
    query = " ".join(query.split())
    if not QUERY_RE.match(query):
        raise NoData("Wpisz nazwę obrębu i numer działki, np. „Niedrzwica Kościelna 580/2”, albo pełny identyfikator.")
    try:
        lines = await _request(client, {"request": "GetParcelByIdOrNr", "id": query, "result": RESULT_FIELDS})
    except (SourceError, RuntimeError) as exc:
        return await _search_without_uldk(client, query, exc)
    if lines[0].startswith("-1"):
        return [], False
    candidates = [_parse_fields(line) for line in lines[1:] if "|" in line]
    candidates = [c for c in candidates if c["id"]]
    return candidates[:MAX_CANDIDATES], len(candidates) > MAX_CANDIDATES


def split_district_and_number(query: str) -> tuple[str, str] | None:
    """„Niedrzwica Kościelna 580/2” → („Niedrzwica Kościelna”, „580/2”). None, gdy brak numeru na końcu."""
    parts = query.replace(",", " ").split()
    if len(parts) < 2 or not parts[-1][0].isdigit():
        return None
    return " ".join(parts[:-1]), parts[-1]


async def _search_without_uldk(client: httpx.AsyncClient, query: str,
                               uldk_error: Exception) -> tuple[list[dict[str, str | None]], bool]:
    """Wyszukiwanie przy awarii ULDK: pełny identyfikator albo nazwa obrębu (PRG) + numer → WFS EGiB."""
    if is_full_id(query):
        parcel, _ = await get_parcel_by_id(client, query)  # sam przechodzi na WFS EGiB
        return [_candidate(parcel)], False
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
    results = await asyncio.gather(*(get_parcel_by_id(client, pid) for pid in ids), return_exceptions=True)
    candidates = [_candidate(r[0]) for r in results if isinstance(r, tuple)]
    if not candidates:
        errors = [r for r in results if isinstance(r, SourceError)]
        if errors:
            raise errors[0]
        return [], False
    return candidates, len(districts) > egib_wfs.MAX_DISTRICTS


def _candidate(p: Parcel) -> dict[str, str | None]:
    return {"id": p.id, "voivodeship": p.voivodeship, "county": p.county, "commune": p.commune,
            "region": p.region, "number": p.number}
