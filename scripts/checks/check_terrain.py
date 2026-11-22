"""Sprawdzenie analizy spływu na prawdziwym modelu terenu.

Wzorzec dla 060910_2.0011.580/2 (docs/assets/splyw_wody_dzialka_580_2.png): 4 punkty dopływu, 4 punkty odpływu,
największy odpływ 1,63 ha przy południowo-wschodniej granicy, wysokości na działce 202,45–203,65 m.

  python scripts/checks/check_terrain.py                      # pobiera NMT z WCS GUGiK (kilkanaście do kilkudziesięciu sekund)
  python scripts/checks/check_terrain.py 060910_2.0011.580/2 plik.tif   # liczy na wcześniej pobranym wycinku
"""
from __future__ import annotations

import asyncio
import sys
import time
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from app.core import terrain_rules  # noqa: E402
from app.core.terrain_analysis import analyse_parcel  # noqa: E402
from app.infra.geo import reproject  # noqa: E402
from app.sources import parcels, terrain  # noqa: E402


async def main() -> None:
    parcel_id = sys.argv[1] if len(sys.argv) > 1 else "060910_2.0011.580/2"
    sys.stdout.reconfigure(encoding="utf-8")
    async with httpx.AsyncClient() as client:
        parcel, _ = await parcels.get_parcel_by_id(client, parcel_id)
        if len(sys.argv) > 2:
            import rasterio
            with rasterio.open(sys.argv[2]) as ds:
                dem, transform = ds.read(1).astype(float), ds.transform
            _bounds, buffer_m = terrain.window_bounds(reproject(parcel.geometry, "EPSG:4326", "EPSG:2180"))
            analysis = analyse_parcel(parcel.geometry, dem, transform, buffer_m)
        else:
            t0 = time.perf_counter()
            window = await terrain.fetch_parcel_dem(client, parcel.geometry)
            analysis = analyse_parcel(parcel.geometry, window.dem, window.transform, window.buffer_m)
            print(f"pobranie i analiza: {time.perf_counter() - t0:.1f} s")
    facts = analysis.facts
    print(f"{parcel.id}: komórka {analysis.cell_m} m, bufor {analysis.buffer_m} m, pobranie {analysis.fetch_s} s, "
          f"obliczenia {analysis.compute_s} s")
    print(f"wysokości {facts.elevation_min_m:.2f}–{facts.elevation_max_m:.2f} m, spadek średni {facts.slope_mean_pct:.1f}%, "
          f"p90 {facts.slope_p90_pct:.1f}%, zagłębienia {facts.depression_area_m2:.0f} m2 do {facts.depression_max_depth_m:.2f} m")
    for kind in ("inflow", "outflow"):
        points = sorted((p for p in facts.points if p.kind == kind), key=lambda p: -p.area_ha)
        print(f"{kind}: {len(points)} ->", [(round(p.area_ha, 2), p.side) for p in points])
    print("dróg spływu:", len(analysis.flow_paths["features"]))
    conclusions = terrain_rules.conclude(facts)
    for line in conclusions.text:
        print(" -", line)
    for _key, title, text in conclusions.causes:
        print(" * przyczyna:", title, "-", text)
    for rec in conclusions.recommendations:
        print(f" > [{rec.category}] {rec.title}: {rec.what} | {rec.where} | {rec.why} | {rec.confidence}")


if __name__ == "__main__":
    asyncio.run(main())
