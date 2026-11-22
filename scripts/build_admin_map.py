"""Granice województw, powiatów i gmin do widoku „Mapa pól” (static/mapa/*.json).

Źródło: Państwowy Rejestr Granic (GUGiK), usługa WFS AdministrativeBoundaries, warstwy A01–A03, EPSG:2180.
Granice upraszczamy jako pokrycie (shapely.coverage_simplify), więc sąsiednie jednostki dalej się stykają,
i zapisujemy w EPSG:4326 (GeoJSON, lon/lat):
- wojewodztwa.json: 16 województw;
- woj/<WW>.json: powiaty i gminy jednego województwa (doczytywane dopiero po wejściu w województwo).
Każda jednostka ma kod TERYT (`kod`: WW, WWPP albo WWPPGGT), nazwę i punkt etykiety (`lp`, lon/lat).

Uruchomienie (pobiera ok. 220 MB GML do cache/prg przy pierwszym razie):
    python scripts/build_admin_map.py
"""
import json
import sys
import xml.etree.ElementTree as ET
from collections import defaultdict
from pathlib import Path

import httpx
import numpy as np
import shapely
from pyproj import Transformer
from shapely.geometry import MultiPolygon, Polygon, mapping
from shapely.ops import polylabel

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "cache" / "prg"
OUT = ROOT / "static" / "mapa"
WFS = ("https://mapy.geoportal.gov.pl/wss/service/PZGIK/PRG/WFS/AdministrativeBoundaries"
       "?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&TYPENAMES=ms:")
LAYERS = {"woj": "A01_Granice_wojewodztw", "pow": "A02_Granice_powiatow", "gmi": "A03_Granice_gmin"}
# tolerancja upraszczania (m, EPSG:2180; Visvalingam-Whyatt, ~pierwiastek z pola usuwanego trójkąta) dobrana do skali,
# w jakiej jednostka jest rysowana: województwa na mapie Polski (~1,2 km/px), powiaty w województwie (~0,3 km/px),
# gminy w powiecie (~70 m/px). Drobniej rośnie rozmiar plików (gminy przy 60 m: 12 MB zamiast ~4 MB).
TOLERANCE_M = {"woj": 2000, "pow": 500, "gmi": 200}
DIGITS = 4   # ok. 10 m na stopniu szerokości: poniżej najmniejszej tolerancji
GML = "{http://www.opengis.net/gml/3.2}"
MS = "{http://mapserver.gis.umn.edu/mapserver}"
TO_WGS84 = Transformer.from_crs(2180, 4326, always_xy=True).transform
GMINA_TYPE = {"1": "gmina miejska", "2": "gmina wiejska", "3": "gmina miejsko-wiejska"}


def download(layer: str) -> Path:
    path = CACHE / f"{layer}.gml"
    if not path.exists():
        CACHE.mkdir(parents=True, exist_ok=True)
        with httpx.stream("GET", WFS + layer, timeout=600) as response:
            response.raise_for_status()
            with path.open("wb") as file:
                for chunk in response.iter_bytes():
                    file.write(chunk)
    return path


def ring(element) -> list[tuple[float, float]]:
    values = [float(v) for v in element.find(f".//{GML}posList").text.split()]
    # urn:ogc:def:crs:EPSG::2180 ma kolejność osi (northing, easting); shapely dostaje (x=easting, y=northing)
    return [(values[i + 1], values[i]) for i in range(0, len(values), 2)]


def read_units(path: Path) -> list[dict]:
    units = []
    for _, element in ET.iterparse(path):
        if element.tag != f"{GML}featureMember" and not element.tag.endswith("}member"):
            continue
        feature = element[0]
        polygons = [Polygon(ring(p.find(f"{GML}exterior")), [ring(i) for i in p.findall(f"{GML}interior")])
                    for p in feature.iter(f"{GML}Polygon")]
        units.append({"kod": feature.findtext(f"{MS}JPT_KOD_JE"), "nazwa": feature.findtext(f"{MS}JPT_NAZWA_"),
                      "geometry": shapely.make_valid(MultiPolygon(polygons))})
        element.clear()
    return units


def feature(unit: dict, geometry) -> dict:
    largest = max(getattr(geometry, "geoms", [geometry]), key=lambda g: g.area)
    label = TO_WGS84(*polylabel(largest, tolerance=50).coords[0])
    geometry = shapely.set_precision(shapely.transform(geometry, lambda xy: np.column_stack(TO_WGS84(*xy.T))), 10 ** -DIGITS)
    name = unit["nazwa"]
    if len(unit["kod"]) == 7:   # gmina: nazwa z rodzajem, bo np. Lubartów jest gminą miejską i osobno wiejską
        name = f"{GMINA_TYPE.get(unit['kod'][-1], 'gmina')} {name}"
    return {"type": "Feature", "geometry": mapping(geometry),
            "properties": {"kod": unit["kod"], "nazwa": name, "lp": [round(label[0], DIGITS), round(label[1], DIGITS)]}}


def simplified(units: list[dict], level: str) -> list[dict]:
    geometries = shapely.coverage_simplify([u["geometry"] for u in units], TOLERANCE_M[level])
    return [feature(u, g) for u, g in zip(units, geometries) if not g.is_empty]


def write(path: Path, features: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"type": "FeatureCollection", "features": features},
                               ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def main() -> None:
    units = {level: read_units(download(layer)) for level, layer in LAYERS.items()}
    codes = {level: sorted(u["kod"] for u in rows) for level, rows in units.items()}
    for level, rows in codes.items():
        if len(rows) != len(set(rows)):
            sys.exit(f"Powtórzone kody TERYT w warstwie {level}: dane PRG wymagają sprawdzenia")
    print({level: len(rows) for level, rows in codes.items()})
    write(OUT / "wojewodztwa.json", simplified(units["woj"], "woj"))
    powiaty, gminy = simplified(units["pow"], "pow"), simplified(units["gmi"], "gmi")
    by_woj = defaultdict(list)
    for item in powiaty + gminy:
        by_woj[item["properties"]["kod"][:2]].append(item)
    for woj, features in sorted(by_woj.items()):
        write(OUT / "woj" / f"{woj}.json", features)
    total = sum(p.stat().st_size for p in OUT.rglob("*.json"))
    print(f"zapisano {len(by_woj) + 1} plików, razem {total / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
