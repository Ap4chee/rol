"""Sprawdzenie działającego serwera przez HTTP: raport, a potem dociągane części (satelita, teren).

  python scripts/http_check.py 060910_2.0011.580/2 winter_wheat 2026-11-21
  python scripts/http_check.py 301103_2.0017.119/2 spring_barley 2018-07-15 http://127.0.0.1:8000
"""
from __future__ import annotations

import sys
import time

import httpx


def main() -> None:
    parcel, crop, day = sys.argv[1], sys.argv[2], sys.argv[3]
    base = sys.argv[4] if len(sys.argv) > 4 else "http://127.0.0.1:8000"
    sys.stdout.reconfigure(encoding="utf-8")
    with httpx.Client(base_url=base, timeout=180.0) as client:
        t0 = time.perf_counter()
        response = client.post("/api/report", json={"parcel_id": parcel, "crop": crop, "date": day})
        elapsed = time.perf_counter() - t0
        print(f"POST /api/report -> {response.status_code} w {elapsed:.1f} s")
        if response.status_code != 200:
            print(response.text[:500])
            return
        report = response.json()
        print("  nagłówek:", report["water_status"].get("headline") or report["water_status"].get("reason"))
        print("  czasy:", report["timings_s"])
        for name in ("water_status", "satellite", "history", "causes", "soil", "terrain", "hydrology", "recommendations"):
            section = report[name]
            print(f"  {name:16s} {section['status']:8s} {(section.get('reason') or '')[:110]}")
        for source in report["sources"]:
            print(f"  źródło {source['key']:15s} {source['status']:8s} {source['elapsed_s']} s  {(source.get('reason') or '')[:90]}")
        recs = report["recommendations"]
        print("  rekomendacje:", {k: len(recs[k]) for k in ("retention", "agrotechnical", "irrigation", "field_checks")})

        for name in ("satellite", "terrain"):
            section = report[name]
            if section["status"] == "pending" and section.get("endpoint"):
                t0 = time.perf_counter()
                follow = client.get(section["endpoint"])
                took = time.perf_counter() - t0
                body = follow.json()
                inner = body.get("satellite", body)
                print(f"GET {section['endpoint']} -> {follow.status_code} w {took:.1f} s: {inner.get('status')} "
                      f"{(inner.get('reason') or '')[:120]}")
                for line in inner.get("text", []):
                    print("    -", line)
                if name == "satellite":
                    for obs in inner.get("observations", []):
                        if obs["accepted"]:
                            print(f"    {obs['date']} {obs['scene_id']} {obs['valid_pixels']}/{obs['total_pixels']} "
                                  f"NDVI {obs['ndvi']} NDMI {obs['ndmi']}")
                else:
                    crossings = (body.get("crossings") or {}).get("features", [])
                    print("    punkty:", [(f["properties"]["kind"], f["properties"]["area_ha"]) for f in crossings])
                    print("    przyczyny:", [c["title"] for c in body.get("causes", [])],
                          "| rekomendacje:", [r["title"] for r in body.get("recommendations", [])])


if __name__ == "__main__":
    main()
