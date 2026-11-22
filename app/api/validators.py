"""Wspólne parametry zapytań: współrzędne w granicach Polski (EPSG:4326) i identyfikator działki."""
from __future__ import annotations

from typing import Annotated

from fastapi import Query

from app.config import POLAND_LAT_MAX, POLAND_LAT_MIN, POLAND_LON_MAX, POLAND_LON_MIN

Lon = Annotated[float, Query(ge=POLAND_LON_MIN, le=POLAND_LON_MAX)]
Lat = Annotated[float, Query(ge=POLAND_LAT_MIN, le=POLAND_LAT_MAX)]
ParcelId = Annotated[str, Query(min_length=5, max_length=80)]
FieldId = Annotated[str, Query(min_length=1, max_length=120)]
