"""Najbliższy ciek z Mapy Podziału Hydrograficznego Polski MPHP10k (Wody Polskie, ISOK).

Wektory z usługi WFS wymagają logowania (GetFeature przekierowuje na stronę logowania Wód Polskich), ale
publiczna usługa WMS (GeoServer) w odpowiedzi GetFeatureInfo z INFO_FORMAT=application/json oddaje pełną
geometrię odcinków cieków (warstwa HY.Network) razem z nazwą. Sprawdzone prawdziwymi wywołaniami 22.11.2026:
- serwer po cichu obcina BUFFER do 25 px (51 px z BUFFER=25 daje komplet obiektów, 55 px z BUFFER=27 już nie),
  dlatego obraz ma 51 px, a punkt zapytania leży w jego środku;
- GeoServer upraszcza linie do rozmiaru piksela zapytania, więc przy oknie ok. 3 km (ok. 60 m na piksel)
  odległość jest zgrubna; drugie zapytanie w wąskim oknie wokół najbliższego punktu cieku daje ją z dokładnością
  kilku metrów (zwracany jest cały odcinek, uproszczony już do małego piksela);
- WMS 1.3.0 z CRS=EPSG:4326 przyjmuje BBOX w kolejności szerokość, długość, a GeoJSON w odpowiedzi ma (lon, lat);
- nazwa cieku jest w polu `gn_spelling` (bywa pusta); odpowiedź przychodzi w 0,2–10 s.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

import httpx
from shapely.geometry import box, shape
from shapely.geometry.base import BaseGeometry
from shapely.ops import nearest_points

from app.config import check_forced_failure
from app.infra import cache
from app.infra.geo import reproject
from app.sources import SourceError

WMS_URL = "https://wody.isok.gov.pl/wss/INSPIRE/INSPIRE_HY_10k_2019_WMS"
LAYER = "HY.Network"
SEARCH_RADIUS_M = 800.0
MAX_BUFFER_PX = 25                  # limit serwera
IMAGE_PX = 2 * MAX_BUFFER_PX + 1    # punkt zapytania w środku, bufor sięga krawędzi obrazu
REFINE_HALF_PX = 3                  # drugie okno: ±3 piksele pierwszego wokół najbliższego punktu cieku
FEATURE_COUNT = 500
TIMEOUT_S = 15.0
CACHE_MAX_AGE_S = 30 * 24 * 3600    # mapa cieków zmienia się rzadko


@dataclass
class Watercourse:
    name: str | None
    distance_m: float   # od granicy działki (albo od punktu), liczona w EPSG:2180; 0 = ciek przecina działkę
    nearest_xy: tuple[float, float] | None = None   # najbliższy punkt cieku, EPSG:2180 (x = E, y = N)


def search_half_m(geometry_2180: BaseGeometry) -> float:
    """Połowa boku kwadratu, w którym mieści się wszystko do SEARCH_RADIUS_M od działki. √2, bo nie wiemy,
    czy bufor GeoServera jest kwadratem, czy kołem."""
    minx, miny, maxx, maxy = geometry_2180.bounds
    return max(maxx - minx, maxy - miny) / 2 * math.sqrt(2) + SEARCH_RADIUS_M


def query_params(cx: float, cy: float, half_m: float) -> dict[str, str | int]:
    """Parametry GetFeatureInfo dla kwadratu o środku (cx, cy) w EPSG:2180 i połowie boku `half_m`."""
    window = reproject(box(cx - half_m, cy - half_m, cx + half_m, cy + half_m), "EPSG:2180", "EPSG:4326")
    lon0, lat0, lon1, lat1 = window.bounds
    return {"SERVICE": "WMS", "VERSION": "1.3.0", "REQUEST": "GetFeatureInfo", "CRS": "EPSG:4326",
            "BBOX": f"{lat0:.6f},{lon0:.6f},{lat1:.6f},{lon1:.6f}", "WIDTH": IMAGE_PX, "HEIGHT": IMAGE_PX,
            "I": MAX_BUFFER_PX, "J": MAX_BUFFER_PX, "BUFFER": MAX_BUFFER_PX, "LAYERS": LAYER, "QUERY_LAYERS": LAYER,
            "STYLES": "", "INFO_FORMAT": "application/json", "FEATURE_COUNT": FEATURE_COUNT}


def nearest(features: list[dict], geometry_2180: BaseGeometry) -> Watercourse | None:
    """Najbliższy odcinek cieku w promieniu SEARCH_RADIUS_M. `features`: GeoJSON w EPSG:4326 (lon, lat)."""
    best: Watercourse | None = None
    for feature in features:
        # warstwa zwraca też węzły sieci (Point) bez nazwy; ciek to tylko linie
        if "LineString" not in ((feature.get("geometry") or {}).get("type") or ""):
            continue
        line_2180 = reproject(shape(feature["geometry"]), "EPSG:4326", "EPSG:2180")
        distance_m = geometry_2180.distance(line_2180)
        if distance_m <= SEARCH_RADIUS_M and (best is None or distance_m < best.distance_m):
            point = nearest_points(geometry_2180, line_2180)[1]
            best = Watercourse((feature.get("properties") or {}).get("gn_spelling") or None, distance_m,
                               (point.x, point.y))
    return best


async def _features(client: httpx.AsyncClient, cx: float, cy: float, half_m: float) -> list[dict]:
    try:
        response = await client.get(WMS_URL, params=query_params(cx, cy, half_m), timeout=TIMEOUT_S)
        response.raise_for_status()
        return response.json()["features"]
    except (httpx.HTTPError, ValueError, KeyError, TypeError) as exc:
        raise SourceError(f"usługa WMS mapy cieków MPHP10k nie odpowiedziała poprawnie ({type(exc).__name__})") from exc


async def fetch_nearest_watercourse(client: httpx.AsyncClient,
                                    geometry: BaseGeometry) -> tuple[Watercourse | None, bool]:
    """Najbliższy ciek dla działki albo punktu w EPSG:4326. None = brak cieku w promieniu SEARCH_RADIUS_M.
    Drugi element: czy wynik pochodzi z pamięci podręcznej."""
    check_forced_failure("watercourses")
    key = f"{geometry.wkt}|{SEARCH_RADIUS_M}"
    cached = cache.get("mphp", key, max_age_s=CACHE_MAX_AGE_S)
    if cached is not None:
        return (Watercourse(cached["name"], cached["distance_m"]) if cached["distance_m"] is not None else None), True
    geometry_2180 = reproject(geometry, "EPSG:4326", "EPSG:2180")
    minx, miny, maxx, maxy = geometry_2180.bounds
    half_m = search_half_m(geometry_2180)
    result = nearest(await _features(client, (minx + maxx) / 2, (miny + maxy) / 2, half_m), geometry_2180)
    if result is not None:
        pixel_m = 2 * half_m / IMAGE_PX
        x, y = result.nearest_xy
        result = nearest(await _features(client, x, y, REFINE_HALF_PX * pixel_m), geometry_2180) or result
    cache.put("mphp", key, {"name": result.name if result else None,
                            "distance_m": result.distance_m if result else None})
    return result, False
