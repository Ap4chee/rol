"""Czy przesunięcie reflektancji jest już odjęte w pikselach sceny? Porównanie tej samej sceny w obu kolekcjach.

Kolekcja `sentinel-2-l2a` podaje w `raster:bands` offset −0,1 także dla scen, w których przesunięcie 1000 DN
zostało już odjęte (`earthsearch:boa_offset_applied = true`). Skrypt bierze sceny obecne w obu kolekcjach,
czyta ten sam wycinek pasma B8A i wypisuje medianę DN oraz reflektancję liczoną tak, jak robi to aplikacja
(`app.sources.sentinel._scene_from_item`). Zgodna reflektancja w obu kolekcjach = offset stosowany poprawnie.

Przykład:
  python scripts/checks/check_sentinel_offset.py --point 22.36,51.09 --window 2023-06-01/2023-06-30
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from app.sources.sentinel import COLLECTIONS, GDAL_OPTIONS, STAC_URL, _scene_from_item  # noqa: E402


def median_dn(href: str, lon: float, lat: float) -> float:
    import rasterio
    from pyproj import Transformer
    from rasterio.windows import from_bounds

    with rasterio.Env(**GDAL_OPTIONS), rasterio.open(href) as ds:
        tr = Transformer.from_crs("EPSG:4326", ds.crs, always_xy=True)
        x, y = tr.transform(lon, lat)   # okno 1 × 1 km wokół punktu, w układzie sceny (UTM)
        dn = ds.read(1, window=from_bounds(x - 500, y - 500, x + 500, y + 500, ds.transform))
    dn = dn[dn > 0]
    return float(np.median(dn)) if dn.size else float("nan")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--point", default="22.36,51.09", help="lon,lat w EPSG:4326")
    parser.add_argument("--window", default="2023-06-01/2023-06-30", help="zakres dat RRRR-MM-DD/RRRR-MM-DD")
    parser.add_argument("--max-cloud", type=float, default=20.0, help="największe zachmurzenie sceny [%%]")
    args = parser.parse_args()
    lon, lat = (float(v) for v in args.point.split(","))
    from pystac_client import Client

    client = Client.open(STAC_URL)
    geometry = {"type": "Point", "coordinates": [lon, lat]}
    by_pass: dict[tuple, dict] = {}
    for collection in COLLECTIONS:
        for item in client.search(collections=[collection], intersects=geometry, datetime=args.window, limit=100).items():
            if item.properties.get("eo:cloud_cover", 100.0) > args.max_cloud:
                continue
            scene = _scene_from_item(item, collection)
            if scene is not None:
                by_pass.setdefault((*scene.pass_key, scene.tile), {})[collection] = (scene, item)
    both = {key: found for key, found in by_pass.items() if len(found) == len(COLLECTIONS)}
    print(f"sceny z zachmurzeniem do {args.max_cloud:.0f}%: {len(by_pass)}, w obu kolekcjach: {len(both)}")
    for key, found in sorted(both.items()):
        values = []
        for collection in COLLECTIONS:
            scene, item = found[collection]
            dn = median_dn(scene.hrefs["nir08"], lon, lat)
            reflectance = dn * scene.scale["nir08"] + scene.offset["nir08"]
            values.append(reflectance)
            print(f"  {key[1]} {key[0]} {key[2]} {collection}: baza {item.properties.get('s2:processing_baseline')}, "
                  f"offset już odjęty: {item.properties.get('earthsearch:boa_offset_applied')}, B8A mediana DN {dn:.0f}, "
                  f"offset użyty {scene.offset['nir08']}, reflektancja {reflectance:.4f}")
        print(f"    różnica reflektancji między kolekcjami: {abs(values[0] - values[1]):.4f}")


if __name__ == "__main__":
    main()
