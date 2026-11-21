"""Adapter usługi ULDK GUGiK (https://uldk.gugik.gov.pl): sam protokół, bez polityki zapasowej i cache.

Wybór źródła, pamięć podręczna i pochodzenie wyniku są w `app.sources.parcels`.

Sprawdzone prawdziwymi wywołaniami 21.11.2026:
- GetParcelById i GetParcelByXY: pierwsza linia `0` = sukces, `-1 ...` = brak wyników.
- GetParcelByIdOrNr: pierwsza linia to liczba trafień.
- Zdarza się strona HTML „Request Rejected”: odpowiedź, która nie zaczyna się od cyfry
  (ani od `-1`), traktujemy jako błąd i ponawiamy raz.
"""
from __future__ import annotations

import httpx
from shapely import wkt

from app.config import TIMEOUT_ULDK_S, check_forced_failure
from app.sources import NoData, SourceError

ULDK_URL = "https://uldk.gugik.gov.pl/"
RESULT_FIELDS = "teryt,voivodeship,county,commune,region,parcel"
# 21.11.2026 wieczorem ULDK (i inne usługi integracja.gugik.gov.pl) odpowiadały na każde zapytanie, z różnych
# adresów IP, przekierowaniem 302 na integracja01.gugik.gov.pl/resp/uldk.php: strona zastępcza na czas awarii.
UNAVAILABLE_MESSAGE = ("Usługa działek GUGiK (ULDK) jest chwilowo niedostępna – serwer GUGiK przekierowuje wszystkie "
                       "zapytania na stronę zastępczą (awaria po stronie GUGiK)")


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


def parse_fields(line: str) -> dict[str, str | None]:
    """Pola opisowe rekordu ULDK: id, województwo, powiat, gmina, obręb, numer."""
    parts = line.split("|")
    names = ["id", "voivodeship", "county", "commune", "region", "number"]
    return {name: (parts[i].strip() or None) if i < len(parts) else None for i, name in enumerate(names)}


def parse_parcel(line: str) -> dict:
    """Rekord działki z geometrią (EPSG:4326, lon, lat). Uszkodzony rekord → SourceError."""
    parts = line.split("|")
    if len(parts) < 7:
        raise SourceError("ULDK zwróciło niepełny rekord działki")
    record: dict = parse_fields(line)
    geom_text = parts[6].strip()
    if ";" in geom_text:  # "SRID=4326;POLYGON((...))"
        geom_text = geom_text.split(";", 1)[1]
    try:
        geometry = wkt.loads(geom_text)
    except Exception as exc:  # shapely zgłasza różne typy wyjątków zależnie od wersji
        raise SourceError("ULDK zwróciło nieczytelną geometrię działki") from exc
    if geometry.is_empty or geometry.geom_type not in ("Polygon", "MultiPolygon"):
        raise SourceError("ULDK zwróciło geometrię, która nie jest wielokątem")
    if not record["id"]:
        raise SourceError("ULDK nie zwróciło identyfikatora działki")
    record["geometry"] = geometry
    return record


async def fetch_parcel_by_id(client: httpx.AsyncClient, parcel_id: str) -> dict:
    """Działka po pełnym identyfikatorze."""
    lines = await _request(client, {
        "request": "GetParcelById", "id": parcel_id,
        "result": RESULT_FIELDS + ",geom_wkt", "srid": "4326",
    })
    if lines[0].startswith("-1") or len(lines) < 2:
        raise NoData(f"ULDK nie zna działki o identyfikatorze {parcel_id}.")
    return parse_parcel(lines[1])


async def fetch_parcel_by_point(client: httpx.AsyncClient, lon: float, lat: float) -> dict:
    """Działka zawierająca punkt (EPSG:4326). ULDK przyjmuje kolejność: długość, szerokość, układ."""
    lines = await _request(client, {
        "request": "GetParcelByXY", "xy": f"{lon:.7f},{lat:.7f},4326",
        "result": RESULT_FIELDS + ",geom_wkt", "srid": "4326",
    })
    if lines[0].startswith("-1") or len(lines) < 2:
        raise NoData("W tym punkcie ULDK nie zwraca działki ewidencyjnej (punkt poza Polską albo poza ewidencją).")
    return parse_parcel(lines[1])


async def search(client: httpx.AsyncClient, query: str) -> list[dict[str, str | None]]:
    """Kandydaci (bez geometrii) dla „nazwa obrębu numer” albo identyfikatora. Pusta lista = brak trafień."""
    lines = await _request(client, {"request": "GetParcelByIdOrNr", "id": query, "result": RESULT_FIELDS})
    if lines[0].startswith("-1"):
        return []
    candidates = [parse_fields(line) for line in lines[1:] if "|" in line]
    return [c for c in candidates if c["id"]]
