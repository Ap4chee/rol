"""Sprawdzenia końcowe na prawdziwych danych: pusty cache, wymuszone awarie źródeł, data historyczna.

Każdy przebieg to osobny proces z własnym katalogiem pamięci podręcznej (zmienna KOWR_CACHE_DIR)
i ewentualnie wymuszoną awarią (KOWR_FAIL). Wypisuje czasy źródeł i statusy sekcji.

  python scripts/acceptance.py
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CASES = [
    ("pusty cache: 580/2, pszenica ozima, dziś", ["--parcel", "060910_2.0011.580/2", "--crop", "winter_wheat"], ""),
    ("pusty cache: punkt w Wielkopolsce, jęczmień jary, 2018-07-15",
     ["--point", "16.62,52.05", "--crop", "spring_barley", "--date", "2018-07-15"], ""),
    ("awaria gleby (WCS, REST i kafle)", ["--parcel", "060910_2.0011.580/2", "--crop", "winter_wheat"],
     "soil_wcs,soil_rest,soil_vrt"),
    ("awaria satelity", ["--parcel", "060910_2.0011.580/2", "--crop", "maize", "--date", "2025-07-20"], "satellite"),
    ("awaria obu archiwów pogody", ["--parcel", "060910_2.0011.580/2", "--crop", "winter_wheat"],
     "weather_archive,weather_power"),
    ("awaria ULDK przy wskazaniu punktu", ["--point", "22.3559,51.0933", "--crop", "potato", "--date", "2024-08-01"], "uldk"),
]


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    for title, args, fail in CASES:
        with tempfile.TemporaryDirectory(prefix="kowr-cache-") as cache_dir:
            env = {**os.environ, "KOWR_CACHE_DIR": cache_dir, "KOWR_FAIL": fail, "PYTHONIOENCODING": "utf-8"}
            proc = subprocess.run([sys.executable, str(ROOT / "scripts" / "run_report.py"), *args, "--json"],
                                  capture_output=True, text=True, encoding="utf-8", env=env, timeout=300)
        print(f"\n=== {title}" + (f"  [KOWR_FAIL={fail}]" if fail else ""))
        if proc.returncode != 0:
            print("   BŁĄD PROCESU:", (proc.stderr or proc.stdout).strip().splitlines()[-1][:300])
            continue
        report = json.loads(proc.stdout[proc.stdout.index("{"):])
        print(f"   czas raportu: {report['elapsed_s']} s | czasy: {report['timings_s']}")
        print("   wynik:", report["water_status"].get("headline") or report["water_status"].get("reason"))
        print("   sekcje:", {name: report[name]["status"] for name in
                             ("water_status", "satellite", "history", "causes", "soil", "terrain", "hydrology", "recommendations")})
        for source in report["sources"]:
            if source["status"] != "ok":
                print(f"   źródło {source['key']}: {source['status']} – {(source.get('reason') or '')[:150]}")
                if source.get("impact"):
                    print(f"      wpływ: {source['impact'][:170]}")


if __name__ == "__main__":
    main()
