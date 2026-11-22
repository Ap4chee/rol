"""Działka w odpowiedzi API: obrys GeoJSON, środek i zasięg w EPSG:4326."""
from __future__ import annotations

from app.schemas import ParcelInfo, Point
from app.sources.parcels import Parcel


def parcel_info(parcel: Parcel) -> ParcelInfo:
    lon, lat = parcel.centroid_lonlat
    minx, miny, maxx, maxy = parcel.geometry.bounds
    return ParcelInfo(
        id=parcel.id, number=parcel.number, region=parcel.region, commune=parcel.commune,
        county=parcel.county, voivodeship=parcel.voivodeship, area_ha=round(parcel.area_ha, 4),
        centroid=Point(lon=round(lon, 6), lat=round(lat, 6)), geometry=parcel.geojson(),
        bbox=[minx, miny, maxx, maxy])
