"""Lokalizacja adresów i miejscowości z UUG GUGiK. Wynik służy do ustawienia mapy."""
from __future__ import annotations

import re

import httpx

from app.infra.geo import transformer
from app.schemas import AddressMatch, Point
from app.sources import SourceError

URL = "https://services.gugik.gov.pl/uug"


async def search(client: httpx.AsyncClient, query: str) -> list[AddressMatch]:
    first, comma, second = query.partition(",")
    if comma and second.strip() and re.search(r"\s\d+[\w/-]*$", first.rstrip()):
        query = f"{second.strip()}, {first.strip()}"
    try:
        response = await client.get(URL, params={"request": "GetAddress", "address": query}, timeout=7)
        response.raise_for_status()
        results = response.json()["results"]
    except (httpx.HTTPError, ValueError, KeyError, TypeError) as exc:
        raise SourceError("Wyszukiwarka adresów GUGiK chwilowo nie odpowiada.") from exc
    if results is None:
        return []
    if not isinstance(results, dict):
        raise SourceError("Wyszukiwarka adresów GUGiK zwróciła nieczytelne wyniki.")

    to_lonlat = transformer("EPSG:2180", "EPSG:4326")
    matches: list[AddressMatch] = []
    for entry in results.values():
        try:
            city = entry["city"]
            street = " ".join(str(value) for value in (entry.get("street"), entry.get("number")) if value)
            region = (entry.get("jednostka") or "").strip("{}").split(",")
            lon, lat = to_lonlat.transform(float(entry["x"]), float(entry["y"]))
            match = AddressMatch(
                label=f"{city}, {street}" if street else city,
                region=", ".join(region[1:]),
                point=Point(lon=lon, lat=lat),
                precise=bool(entry.get("number")),
            )
        except (AttributeError, KeyError, TypeError, ValueError):
            continue
        if match not in matches:
            matches.append(match)
    if results and not matches:
        raise SourceError("Wyszukiwarka adresów GUGiK nie podała poprawnych współrzędnych.")
    return matches[:8]
