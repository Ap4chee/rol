"""Przeliczanie geometrii między układami współrzędnych. Układ zawsze nazwany w miejscu użycia."""
from __future__ import annotations

from functools import lru_cache

import shapely
from pyproj import CRS, Transformer
from shapely.geometry.base import BaseGeometry


@lru_cache(maxsize=64)
def transformer(src: str, dst: str) -> Transformer:
    """Transformator między układami podanymi jako "EPSG:xxxx" albo napis PROJ. Kolejność osi: x, y (lon, lat)."""
    return Transformer.from_crs(CRS.from_user_input(src), CRS.from_user_input(dst), always_xy=True)


def reproject(geometry: BaseGeometry, src: str, dst: str) -> BaseGeometry:
    """Geometria przeliczona z układu `src` do `dst`."""
    return shapely.transform(geometry, transformer(src, dst).transform, interleaved=False)
