"""Zapasowe źródło granicy działki: zbiorcza usługa WFS ewidencji gruntów i budynków GUGiK.

Adres: https://mapy.geoportal.gov.pl/wss/service/PZGIK/EGIB/WFS/UslugaZbiorcza (warstwa `ms:dzialki`).
Używana tylko wtedy, gdy ULDK nie odpowiada. Sprawdzone prawdziwymi wywołaniami 21.11.2026, w czasie awarii
ULDK (usługa stoi na innym serwerze niż uldk.gugik.gov.pl i odpowiadała w ok. 0,5 s):
- układ EPSG:2180, a współrzędne w odpowiedzi i w parametrze BBOX idą w kolejności północ (N), wschód (E);
- filtr po `ID_DZIALKI` działa; filtr łączący nazwę obrębu z numerem działki zwraca HTTP 500, więc
  wyszukiwania po nazwie obrębu ta usługa nie zastępuje;
- rekord nie zawiera nazwy powiatu ani województwa (województwo wynika z dwóch pierwszych cyfr TERYT).

Wyszukiwanie „nazwa obrębu numer” bez ULDK idzie dwoma krokami: nazwa obrębu → kod obrębu z usługi WFS
granic administracyjnych PRG GUGiK (warstwa obrębów ewidencyjnych), potem pełny identyfikator
`kod_obrębu.numer` → działka z WFS EGiB. Sprawdzone 21.11.2026:
- filtr równości po nazwie obrębu z polską literą (np. „KOŚCIELNA”) nic nie zwraca, a `PropertyIsLike`
  z polską literą zamienioną na `*` działa (0,5–1 s); dokładne dopasowanie nazwy robimy u siebie;
- nazwy obrębów w PRG są wielkimi literami;
- `PropertyIsLike` po `ID_DZIALKI` w WFS EGiB wisi ponad 30 s, więc działek w arkuszach (`AR_n`)
  tą drogą nie znajdziemy.
"""
from __future__ import annotations

import xml.etree.ElementTree as ET
from xml.sax.saxutils import escape

import httpx
from pyproj import Transformer
from shapely.geometry import MultiPolygon, Polygon
from shapely.geometry import Point as ShapelyPoint
from shapely.geometry.base import BaseGeometry
from shapely import transform as shapely_transform

from app.config import check_forced_failure
from app.sources import NoData, SourceError

WFS_URL = "https://mapy.geoportal.gov.pl/wss/service/PZGIK/EGIB/WFS/UslugaZbiorcza"
PRG_WFS_URL = "https://mapy.geoportal.gov.pl/wss/service/PZGIK/PRG/WFS/AdministrativeBoundaries"
PRG_DISTRICT_LAYER = "ms:A06_Granice_obrebow_ewidencyjnych"
MAX_DISTRICTS = 20  # tyle obrębów o tej samej nazwie sprawdzamy w WFS EGiB (równolegle)
SOURCE_NAME = "Ewidencja gruntów i budynków GUGiK, zbiorcza usługa WFS (zapas przy awarii ULDK)"
TIMEOUT_EGIB_WFS_S = 10.0
POINT_HALF_BOX_M = 1.0  # połowa boku okna wokół punktu [m]; właściwą działkę wybiera test zawierania punktu

_GML = "{http://www.opengis.net/gml/3.2}"
_MS = "{http://mapserver.gis.umn.edu/mapserver}"
_CRS_URN = "urn:ogc:def:crs:EPSG::2180"
# always_xy: x = wschód (E), y = północ (N) w EPSG:2180; x = długość, y = szerokość w EPSG:4326
_TO_2180 = Transformer.from_crs(4326, 2180, always_xy=True)
_TO_4326 = Transformer.from_crs(2180, 4326, always_xy=True)

# Kody województw z rejestru TERYT (dwie pierwsze cyfry identyfikatora działki).
VOIVODESHIP_BY_TERYT = {
    "02": "dolnośląskie", "04": "kujawsko-pomorskie", "06": "lubelskie", "08": "lubuskie", "10": "łódzkie",
    "12": "małopolskie", "14": "mazowieckie", "16": "opolskie", "18": "podkarpackie", "20": "podlaskie",
    "22": "pomorskie", "24": "śląskie", "26": "świętokrzyskie", "28": "warmińsko-mazurskie",
    "30": "wielkopolskie", "32": "zachodniopomorskie",
}


def _ring_en(pos_list: str) -> list[tuple[float, float]]:
    """„N E N E ...” z odpowiedzi WFS → lista (E, N)."""
    values = [float(v) for v in pos_list.split()]
    if len(values) < 8 or len(values) % 2:
        raise SourceError("WFS EGiB zwrócił nieczytelny pierścień geometrii")
    return [(values[i + 1], values[i]) for i in range(0, len(values), 2)]


def parse_parcels(xml_text: str) -> list[dict]:
    """Rekordy działek z odpowiedzi GetFeature. Geometria w EPSG:2180 w kolejności (E, N)."""
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError as exc:
        raise SourceError("WFS EGiB zwrócił odpowiedź, która nie jest poprawnym XML") from exc
    if root.tag.endswith("ExceptionReport"):
        raise SourceError("WFS EGiB odrzucił zapytanie")
    records: list[dict] = []
    for member in root.iter(f"{_MS}dzialki"):
        polygons = []
        for poly in member.iter(f"{_GML}Polygon"):
            exterior = poly.find(f"{_GML}exterior//{_GML}posList")
            if exterior is None or not exterior.text:
                continue
            holes = [_ring_en(h.text) for h in poly.findall(f"{_GML}interior//{_GML}posList") if h.text]
            polygons.append(Polygon(_ring_en(exterior.text), holes))
        if not polygons:
            continue

        def field(name: str) -> str | None:
            node = member.find(f"{_MS}{name}")
            return node.text.strip() if node is not None and node.text and node.text.strip() else None

        parcel_id = field("ID_DZIALKI")
        if not parcel_id:
            continue
        records.append({
            "id": parcel_id, "number": field("NUMER_DZIALKI"),
            "region": field("NAZWA_OBREBU"), "commune": field("NAZWA_GMINY"),
            "geometry_2180": polygons[0] if len(polygons) == 1 else MultiPolygon(polygons),
        })
    return records


def _finish(record: dict) -> dict:
    """Rekord gotowy dla aplikacji: geometria w EPSG:4326 (lon, lat), nazwy zwykłą pisownią."""
    geometry: BaseGeometry = shapely_transform(record["geometry_2180"], _TO_4326.transform, interleaved=False)
    if geometry.is_empty or not geometry.is_valid and geometry.buffer(0).is_empty:
        raise SourceError("WFS EGiB zwrócił pustą geometrię działki")
    minx, miny, maxx, maxy = geometry.bounds
    if not (14.0 <= minx and maxx <= 24.3 and 48.9 <= miny and maxy <= 55.0):
        raise SourceError("WFS EGiB zwrócił geometrię poza Polską")
    return {
        "id": record["id"], "number": record["number"],
        "region": record["region"].title() if record["region"] else None,
        "commune": record["commune"].title() if record["commune"] else None,
        "county": None,  # usługa nie podaje nazwy powiatu
        "voivodeship": VOIVODESHIP_BY_TERYT.get(record["id"][:2]),
        "geometry": geometry,
    }


async def _get_feature(client: httpx.AsyncClient, extra: dict[str, str]) -> list[dict]:
    check_forced_failure("egib_wfs")
    params = {"SERVICE": "WFS", "VERSION": "2.0.0", "REQUEST": "GetFeature", "TYPENAMES": "ms:dzialki",
              "COUNT": "20", **extra}
    try:
        response = await client.get(WFS_URL, params=params, timeout=TIMEOUT_EGIB_WFS_S, follow_redirects=False)
    except httpx.HTTPError as exc:
        raise SourceError(f"WFS EGiB: błąd połączenia ({type(exc).__name__})") from exc
    if response.status_code != 200:
        raise SourceError(f"WFS EGiB: HTTP {response.status_code}")
    return parse_parcels(response.content.decode("utf-8", errors="replace"))


async def fetch_parcel_by_point(client: httpx.AsyncClient, lon: float, lat: float) -> dict:
    """Działka zawierająca punkt (EPSG:4326)."""
    east_m, north_m = _TO_2180.transform(lon, lat)
    d = POINT_HALF_BOX_M
    bbox = f"{north_m - d:.2f},{east_m - d:.2f},{north_m + d:.2f},{east_m + d:.2f},{_CRS_URN}"  # kolejność N, E
    records = await _get_feature(client, {"BBOX": bbox})
    point = ShapelyPoint(east_m, north_m)
    for record in records:
        if record["geometry_2180"].buffer(0).contains(point):
            return _finish(record)
    raise NoData("W tym punkcie ewidencja gruntów (WFS GUGiK) nie zwraca działki "
                 "(punkt poza Polską albo poza ewidencją).")


async def fetch_parcel_by_id(client: httpx.AsyncClient, parcel_id: str) -> dict:
    """Działka po pełnym identyfikatorze."""
    xml_filter = ('<fes:Filter xmlns:fes="http://www.opengis.net/fes/2.0"><fes:PropertyIsEqualTo>'
                  "<fes:ValueReference>ID_DZIALKI</fes:ValueReference>"
                  f"<fes:Literal>{escape(parcel_id)}</fes:Literal></fes:PropertyIsEqualTo></fes:Filter>")
    records = await _get_feature(client, {"FILTER": xml_filter})
    for record in records:
        if record["id"] == parcel_id:
            return _finish(record)
    raise NoData(f"Ewidencja gruntów (WFS GUGiK) nie zna działki o identyfikatorze {parcel_id}.")


def district_name_pattern(name: str) -> str:
    """Wzorzec `PropertyIsLike` dla nazwy obrębu: wielkie litery, każdy znak spoza ASCII zamieniony na `*`."""
    return "".join(ch if ch.isascii() else "*" for ch in " ".join(name.split()).upper())


def parse_districts(xml_text: str) -> list[tuple[str, str]]:
    """Pary (kod obrębu, nazwa obrębu) z odpowiedzi GetFeature warstwy obrębów PRG."""
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError as exc:
        raise SourceError("WFS PRG zwrócił odpowiedź, która nie jest poprawnym XML") from exc
    if root.tag.endswith("ExceptionReport"):
        raise SourceError("WFS PRG odrzucił zapytanie")
    out = []
    for member in root.iter(f"{_MS}{PRG_DISTRICT_LAYER.split(':')[1]}"):
        code, name = member.find(f"{_MS}JPT_KOD_JE"), member.find(f"{_MS}JPT_NAZWA_")
        if code is not None and code.text and name is not None and name.text:
            out.append((code.text.strip(), name.text.strip()))
    return out


async def find_districts(client: httpx.AsyncClient, name: str) -> list[tuple[str, str]]:
    """Obręby ewidencyjne o dokładnie tej nazwie (bez względu na wielkość liter): lista (kod, nazwa)."""
    check_forced_failure("egib_wfs")
    xml_filter = ('<fes:Filter xmlns:fes="http://www.opengis.net/fes/2.0">'
                  '<fes:PropertyIsLike wildCard="*" singleChar="?" escapeChar="!" matchCase="false">'
                  "<fes:ValueReference>JPT_NAZWA_</fes:ValueReference>"
                  f"<fes:Literal>{escape(district_name_pattern(name))}</fes:Literal>"
                  "</fes:PropertyIsLike></fes:Filter>")
    params = {"SERVICE": "WFS", "VERSION": "2.0.0", "REQUEST": "GetFeature", "TYPENAMES": PRG_DISTRICT_LAYER,
              "PROPERTYNAME": "JPT_KOD_JE,JPT_NAZWA_", "COUNT": "200", "FILTER": xml_filter}
    try:
        response = await client.get(PRG_WFS_URL, params=params, timeout=TIMEOUT_EGIB_WFS_S, follow_redirects=False)
    except httpx.HTTPError as exc:
        raise SourceError(f"WFS PRG: błąd połączenia ({type(exc).__name__})") from exc
    if response.status_code != 200:
        raise SourceError(f"WFS PRG: HTTP {response.status_code}")
    wanted = " ".join(name.split()).casefold()
    return [(code, n) for code, n in parse_districts(response.content.decode("utf-8", errors="replace"))
            if " ".join(n.split()).casefold() == wanted]
