"""Sprawdzenie odczytu Sentinel-2 na prawdziwych scenach (wymaga sieci).

Wzorzec z docs/specyfikacja ML dla działki 060910_2.0011.580/2:
  04.06.2025  S2A_T34UEB_20250604T094120_L2A  11/11 pikseli  NDMI 0,59225
  19.06.2025  S2C_T34UEB_20250619T093506_L2A   0/11          odrzucona
  21.06.2025  S2A_T34UEB_20250621T093144_L2A  11/11          NDMI 0,54090

  python scripts/check_sentinel.py                       # wzorzec 580/2, okno do 21.06.2025
  python scripts/check_sentinel.py 060910_2.0011.580/2 2018-07-15
"""
from __future__ import annotations

import asyncio
import sys
import time
from datetime import date
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.report import today_warsaw  # noqa: E402
from app.sources import sentinel, uldk  # noqa: E402

EXPECTED = {
    "S2A_T34UEB_20250604T094120_L2A": (11, 11, 0.59225),
    "S2C_T34UEB_20250619T093506_L2A": (0, 11, None),
    "S2A_T34UEB_20250621T093144_L2A": (11, 11, 0.54090),
}


async def get_parcel(parcel_id: str) -> uldk.Parcel:
    async with httpx.AsyncClient() as client:
        parcel, _ = await uldk.get_parcel_by_id(client, parcel_id)
    return parcel


def main() -> None:
    parcel_id = sys.argv[1] if len(sys.argv) > 1 else "060910_2.0011.580/2"
    parcel = asyncio.run(get_parcel(parcel_id))
    if len(sys.argv) > 2:
        check(parcel, parcel_id, date.fromisoformat(sys.argv[2]))
        return
    # wzorzec: dwa okna, bo wskaźniki liczymy tylko dla najnowszej czystej sceny i dwóch wcześniejszych
    problems = check(parcel, parcel_id, date(2025, 6, 21)) + check(parcel, parcel_id, date(2025, 6, 4))
    print("WYNIK:", "wszystkie wzorce zgodne" if problems == 0 else f"{problems} niezgodności")


def check(parcel: uldk.Parcel, parcel_id: str, day: date) -> int:
    t0 = time.perf_counter()
    result = sentinel.observe(parcel.id, parcel.geometry, day, today_warsaw(), budget_s=60.0)
    print(f"{parcel.id} okno {result.window_from}..{result.window_to}: scen {result.scenes_found}, "
          f"obserwacji {len(result.observations)}, z cache {result.cached_observations}, "
          f"czas {time.perf_counter() - t0:.1f} s, etapy {result.timings_s}, uwagi {result.notes}")
    problems = 0
    for o in result.observations:
        line = (f"  {o.date} {o.scene_id:34s} {o.valid_pixels:3d}/{o.total_pixels:<3d} gleba {o.bare_pixels:3d} "
                f"chmury {o.cloudy_pixels:3d} NDVI {o.ndvi if o.ndvi is None else round(o.ndvi, 4)} "
                f"NDMI {o.ndmi if o.ndmi is None else round(o.ndmi, 5)} {'' if o.accepted else '| ' + str(o.reject_reason)}")
        expected = EXPECTED.get(o.scene_id) if parcel_id == "060910_2.0011.580/2" else None
        if expected:
            valid, total, ndmi = expected
            pixels_ok = (o.valid_pixels, o.total_pixels) == (valid, total)
            if ndmi is not None and o.ndmi is None and o.reject_reason == sentinel.SKIPPED_REASON:
                line += "  <- wzorzec: piksele " + ("zgodne" if pixels_ok else "NIEZGODNE") + ", NDMI w tym oknie nie liczono"
                problems += 0 if pixels_ok else 1
            else:
                ok = pixels_ok and ((ndmi is None and not o.accepted)
                                    or (ndmi is not None and o.ndmi is not None and abs(o.ndmi - ndmi) < 5e-5))
                line += "  <- wzorzec " + ("ZGODNY" if ok else f"NIEZGODNY (oczekiwano {expected})")
                problems += 0 if ok else 1
        if o.reject_reason is None or "chmury" not in o.reject_reason or expected:
            print(line)
    return problems


if __name__ == "__main__":
    main()
