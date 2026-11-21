"""Raport z wiersza poleceń, do sprawdzania na prawdziwych danych bez przeglądarki.

Przykłady:
  python scripts/run_report.py --parcel 060910_2.0011.580/2 --crop winter_wheat
  python scripts/run_report.py --point 17.05,52.40 --crop spring_barley --date 2018-07-15 --json
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.report import build_report, today_warsaw  # noqa: E402
from app.schemas import Point, ReportRequest  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--parcel", help="pełny identyfikator działki")
    parser.add_argument("--point", help="lon,lat w EPSG:4326")
    parser.add_argument("--crop", default="winter_wheat")
    parser.add_argument("--date", default=None, help="RRRR-MM-DD, domyślnie dziś")
    parser.add_argument("--json", action="store_true", help="wypisz cały JSON")
    args = parser.parse_args()

    point = None
    if args.point:
        lon, lat = (float(v) for v in args.point.split(","))
        point = Point(lon=lon, lat=lat)
    request = ReportRequest(parcel_id=args.parcel, point=point, crop=args.crop,
                            date=date.fromisoformat(args.date) if args.date else today_warsaw())
    t0 = time.perf_counter()
    report = asyncio.run(build_report(request))
    elapsed = time.perf_counter() - t0
    sys.stdout.reconfigure(encoding="utf-8")
    if args.json:
        print(json.dumps(report.model_dump(mode="json"), ensure_ascii=False, indent=1))
        return
    print(f"== {report.parcel.id if report.parcel else 'punkt'} | {report.crop.name} | {report.analysis_date} "
          f"| {elapsed:.1f} s")
    if report.parcel:
        print(f"   {report.parcel.region}, gm. {report.parcel.commune}, {report.parcel.voivodeship}; "
              f"{report.parcel.area_ha:.3f} ha")
    print("   faza:", report.crop.stage_name, "| Kc", report.crop.kc, "| w okresie wzrostu:", report.crop.in_season)
    ws = report.water_status
    print("\n[1] SYTUACJA WODNA:", ws.status.value, "|", ws.headline or ws.reason)
    for line in ws.text:
        print("   -", line)
    if ws.uncertainty_text:
        print("   -", ws.uncertainty_text)
    for v in ws.variants:
        print(f"     {v.key:8s} TAW {v.taw_mm:5.0f} RAW {v.raw_mm:5.0f} Dr {v.depletion_mm:5.0f} "
              f"({v.depletion_pct_taw:3.0f}%) Ks {v.ks:.2f} {v.class_key}")
    if ws.climatic_water_balance:
        print("   -", ws.climatic_water_balance.text)
    if ws.last_season:
        print("   -", ws.last_season.text)
    sat = report.satellite
    print("\n[satelita]", sat.status.value, sat.reason or "")
    for line in sat.text:
        print("   -", line)
    for o in sat.observations:
        print(f"     {o.date} {o.scene_id} {o.valid_pixels}/{o.total_pixels} ndvi={o.ndvi} ndmi={o.ndmi} "
              f"{'' if o.accepted else o.reject_reason}")
    h = report.history
    print("\n[historia]", h.status.value, h.reason or "")
    for line in h.text:
        print("   -", line)
    for s in h.seasons:
        print(f"     {s.season}: stres {s.stress_days_critical:3d} dni (ciąg {s.longest_stress_run_days:3d}), "
              f"max {s.max_depletion_pct_taw:3.0f}%{'' if s.complete else ' (sezon trwa)'}")
    c = report.causes
    print("\n[2] PRZYCZYNY", c.status.value, c.reason or "")
    for w in c.windows:
        print(f"     {w.days:3d} dni: opad {w.rain_mm:5.0f} mm ({w.rain_pct_of_median}% mediany {w.rain_median_mm}), "
              f"ET0 {w.et0_mm:5.0f} mm ({w.et0_pct_of_median}% mediany {w.et0_median_mm})")
    for item in c.items:
        print("   -", item.title + ":", item.text)
    for item in c.not_assessed:
        print("   ? ", item)
    soil = report.soil
    print("\n[gleba]", soil.status.value, soil.reason or "", "| komórek:", soil.cells, "|", soil.method or "")
    for layer in soil.layers:
        print(f"     {layer.top_cm:3d}-{layer.bottom_cm:3d} cm: piasek {layer.sand_pct:4.1f} pył {layer.silt_pct:4.1f} "
              f"ił {layer.clay_pct:4.1f} | {layer.texture_label} | PPW {layer.field_capacity_vol_pct} "
              f"PW {layer.wilting_point_vol_pct} | {layer.available_water_mm} mm")
    print("\n[hydrologia]", report.hydrology.status.value, report.hydrology.reason or "", *report.hydrology.text)
    print("[teren]", report.terrain.status.value, report.terrain.reason or "", report.terrain.endpoint or "")
    r = report.recommendations
    print("\n[3-5] REKOMENDACJE", r.status.value, r.reason or "")
    for label, group in (("retencja", r.retention), ("agrotechnika", r.agrotechnical),
                         ("nawadnianie", r.irrigation), ("sprawdź na polu", r.field_checks)):
        for rec in group:
            print(f"   [{label}] {rec.title}\n       co: {rec.what}\n       gdzie: {rec.where}\n       dlaczego: {rec.why}"
                  f"\n       pewność: {rec.confidence} – {rec.confidence_reason}")
    if r.irrigation_note:
        print("   [nawadnianie]", r.irrigation_note)
    print("\n[źródła]")
    for s in report.sources:
        print(f"   {s.status.value:8s} {s.key:15s} {s.name} | {s.data_from}..{s.data_to} {s.data_date or ''} "
              f"| {s.elapsed_s} s{' (cache)' if s.from_cache else ''} {('| ' + s.reason) if s.reason else ''}")
    print("\n[ograniczenia]", len(report.limitations))
    for line in report.limitations[:4]:
        print("   -", line)
    print("\n[czasy]", report.timings_s, "razem", report.elapsed_s)


if __name__ == "__main__":
    main()
