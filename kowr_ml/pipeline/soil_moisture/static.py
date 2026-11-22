"""Gleba i teren dla skupisk (cechy stałe modelu wilgotności) -> cluster_static.parquet.

Liczone tymi samymi funkcjami co w aplikacji dla działki, żeby przy predykcji cechy powstawały tak samo:
gleba z SoilGrids (app/sources/soilgrids.fetch_soil) i pedotransfer Saxtona–Rawlsa (app/core/soil.build_variants),
teren z NMT GUGiK 1 m (app/sources/terrain.fetch_dem) i spadek po wygładzeniu 5 m (app/core/flow.slope_percent).
Działka umowna: kwadrat 200 × 200 m (EPSG:2180) w środku skupiska. Teren jest w tabeli, ale v3 go nie używa.
"""
from __future__ import annotations

import asyncio

import httpx
import numpy as np
from shapely.geometry import box

from app.core.flow import slope_percent
from app.geo import reproject
from app.sources import NoData, SourceError
from app.sources.soilgrids import fetch_soil
from app.sources.terrain import fetch_dem
from kowr_ml.pipeline import config as C
from kowr_ml.runtime.soil_moisture import SOIL_FEATURES, soil_features

HALF_M = 100.0       # połowa boku działki umownej
DEM_PAD_M = 50.0     # zapas wokół działki, żeby gradient na brzegu nie liczył się z krawędzi rastra
STATIC_FEATURES = [*SOIL_FEATURES, "terrain_slope_pct", "terrain_elev_m"]


async def cluster_row(client: httpx.AsyncClient, name: str, lat: float, lon: float, with_terrain: bool) -> dict:
    """Wiersz cech; bez NMT (usługa nie odpowiada) teren zostaje pusty (NaN) z powodem w `terrain_error`."""
    x, y = reproject(box(lon, lat, lon, lat), "EPSG:4326", "EPSG:2180").centroid.coords[0]
    parcel_2180 = box(x - HALF_M, y - HALF_M, x + HALF_M, y + HALF_M)
    row = {"cluster": name, **{k: np.nan for k in STATIC_FEATURES}, "soil_method": None, "soil_error": None,
           "terrain_error": None if with_terrain else "pominięte po wcześniejszym błędzie NMT"}
    try:
        soil = await fetch_soil(client, reproject(parcel_2180, "EPSG:2180", "EPSG:4326"))
        row.update({**soil_features(soil.layers), "soil_method": soil.method})   # ta sama funkcja co w predykcji
    except (SourceError, NoData) as exc:   # np. środek skupiska na zabudowie: brak gleby zostaje brakiem (NaN)
        row["soil_error"] = str(exc)
    if with_terrain:
        pad = HALF_M + DEM_PAD_M
        try:
            dem, transform = await fetch_dem(client, (int(x - pad), int(y - pad), int(x + pad), int(y + pad)))
        except (SourceError, NoData) as exc:
            row["terrain_error"] = str(exc)
            return row
        cell_m = abs(transform.a)
        inner = int(round(DEM_PAD_M / cell_m))
        row["terrain_slope_pct"] = float(np.nanmean(slope_percent(dem, cell_m)[inner:-inner, inner:-inner]))
        row["terrain_elev_m"] = float(np.nanmean(dem[inner:-inner, inner:-inner]))
    return row


async def build():
    import pandas as pd

    async with httpx.AsyncClient() as client:
        rows, with_terrain = [], True
        for name, lat, lon in C.CLUSTERS_FIRST:   # po kolei: SoilGrids i GUGiK nie lubią serii równoległych zapytań
            rows.append(await cluster_row(client, name, lat, lon, with_terrain))
            with_terrain = with_terrain and rows[-1]["terrain_error"] is None   # NMT padło: nie czekaj 180 s na każde
            print(rows[-1], flush=True)
    return pd.DataFrame(rows)


def main() -> None:
    df = asyncio.run(build())
    df.to_parquet(C.DATA_DIR / "cluster_static.parquet", index=False)
    print(df.drop(columns="soil_method").describe().T.round(3).to_string())


if __name__ == "__main__":
    main()
