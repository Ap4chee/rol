"""Wskazanie działki: adres na mapie, kandydaci z wyszukiwania i działka z geometrią."""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

from app.schemas.common import Point, Status


class AddressQuery(BaseModel):
    query: str = Field(min_length=2, max_length=180)


class AddressMatch(BaseModel):
    label: str
    region: str
    point: Point
    precise: bool


class ParcelInfo(BaseModel):
    id: str
    number: str | None = None
    region: str | None = Field(default=None, description="obręb")
    commune: str | None = None
    county: str | None = None
    voivodeship: str | None = None
    area_ha: float
    centroid: Point
    geometry: dict[str, Any] = Field(description="GeoJSON Polygon/MultiPolygon, EPSG:4326")
    bbox: list[float] = Field(description="[lon_min, lat_min, lon_max, lat_max], EPSG:4326")


class ParcelCandidate(BaseModel):
    id: str
    number: str | None = None
    region: str | None = None
    commune: str | None = None
    county: str | None = None
    voivodeship: str | None = None


class ParcelSearchResponse(BaseModel):
    status: Status
    reason: str | None = None
    candidates: list[ParcelCandidate] = []
    truncated: bool = False
    parcel: ParcelInfo | None = Field(default=None, description="pełne dane działki z geometrią (by-point, by-id)")
