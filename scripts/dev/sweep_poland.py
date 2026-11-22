"""Przegląd odporności: działki z różnych regionów Polski × daty (dziś i z ostatnich 10 lat) × uprawy.

Jury uruchamia prototyp na nieznanych działkach i datach, więc ten skrypt sprawdza przebieg od punktu
do raportu na zimnym cache (osobny katalog KOWR_CACHE_DIR na przypadek). Dla każdego przypadku wypisuje
czas, statusy sekcji i źródła, które nie dały danych. Błędy procesu i raporty powyżej 30 s są oznaczone.

  python scripts/dev/sweep_poland.py                 # wszystkie przypadki, 2 naraz
  python scripts/dev/sweep_poland.py --workers 1     # po kolei (czasy bez wpływu równoległości)
  python scripts/dev/sweep_poland.py --out wynik.jsonl
  python scripts/dev/sweep_poland.py --cached-parcels  # działki z cache/uldk, gdy ULDK ma awarię
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TODAY = date.today()
SECTIONS = ("water_status", "satellite", "history", "causes", "soil", "terrain", "hydrology", "recommendations")
SLOW_S = 30.0

# (opis, lon,lat w EPSG:4326, uprawa, data). Punkty wybrane tak, by objąć różne kafle Sentinel-2,
# obie strefy UTM (33N i 34N), niziny, wyżyny, góry i wybrzeże. To nie są działki referencyjne jury.
CASES: list[tuple[str, str, str, str]] = [
    ("Żuławy, dziś", "19.05,54.10", "winter_wheat", TODAY.isoformat()),
    ("Kujawy, susza 2018", "18.40,52.75", "spring_barley", "2018-07-15"),
    ("Wielkopolska, susza 2019", "16.62,52.05", "maize", "2019-06-25"),
    ("Dolny Śląsk, maj 2023", "16.85,50.95", "winter_rapeseed", "2023-05-10"),
    ("Opolszczyzna, sierpień 2021", "17.90,50.55", "sugar_beet", "2021-08-20"),
    ("Podkarpacie, dziś", "22.20,49.95", "maize", TODAY.isoformat()),
    ("Podlasie, czerwiec 2020", "22.90,53.10", "grassland", "2020-06-10"),
    ("Warmia, zima 2022", "20.70,54.00", "winter_wheat", "2022-01-20"),
    ("Pomorze Zachodnie, lipiec 2024", "15.20,53.60", "winter_rapeseed", "2024-07-05"),
    ("Lubuskie, sierpień 2022", "15.30,52.20", "maize", "2022-08-12"),
    ("Mazowsze, kwiecień 2025", "20.60,52.60", "potato", "2025-04-20"),
    ("Małopolska, wrzesień 2017", "20.28,50.20", "sugar_beet", "2017-09-05"),
    ("Świętokrzyskie, lipiec 2026", "20.90,50.60", "spring_barley", "2026-07-10"),
    ("Łódzkie, czerwiec 2019", "19.30,51.90", "potato", "2019-06-15"),
    ("Podhale (góry), lipiec 2023", "20.00,49.35", "grassland", "2023-07-15"),
    ("Lubelszczyzna, wczoraj", "22.3559,51.0933", "winter_wheat", (TODAY - timedelta(days=1)).isoformat()),
    ("Granica 10 lat wstecz", "17.60,52.40", "winter_wheat", (TODAY - timedelta(days=3650)).isoformat()),
    ("Początek zasięgu Sentinel-2, sierpień 2017", "21.50,52.00", "maize", "2017-08-01"),
    ("Krańce wschodnie (strefa 34N/35N)", "23.60,52.70", "grassland", "2024-06-01"),
    ("Krańce zachodnie", "14.90,52.60", "winter_wheat", "2025-06-20"),
    ("Wybrzeże", "17.30,54.70", "potato", "2023-08-25"),
    ("Punkt w mieście (nie pole)", "21.0118,52.2298", "winter_wheat", "2024-07-01"),
    ("Punkt w lesie", "23.85,52.75", "grassland", "2022-07-01"),
    ("Punkt na jeziorze", "21.75,53.80", "maize", "2021-07-01"),
]

# Działki po identyfikatorze, z granicą zapisaną wcześniej w cache/uldk. Uruchamiane z --cached-parcels,
# gdy ULDK ma awarię: do katalogu przypadku kopiowana jest tylko pamięć podręczna ULDK, więc satelita,
# gleba, pogoda i hydrologia nadal idą na zimno. Bez tego przy awarii GUGiK nie da się sprawdzić ścieżki
# z granicą działki (zdjęcia satelitarne, teren).
PARCEL_CASES: list[tuple[str, str, str, str]] = [
    ("580/2 Niedrzwica, dziś", "id:060910_2.0011.580/2", "winter_wheat", TODAY.isoformat()),
    ("580/2 Niedrzwica, czerwiec 2025", "id:060910_2.0011.580/2", "winter_wheat", "2025-06-22"),
    ("538/1 Niedrzwica, sierpień 2022", "id:060910_2.0011.538/1", "maize", "2022-08-10"),
    ("Kościan 119/2, susza 2018", "id:301103_2.0017.119/2", "spring_barley", "2018-07-15"),
    ("Kościan 119/2, marzec 2017 (początek archiwum zdjęć)", "id:301103_2.0017.119/2", "winter_rapeseed", "2017-03-20"),
    ("Wronki 80303/1, maj 2024", "id:302408_5.0003.80303/1", "grassland", "2024-05-15"),
    ("Wronki 80303/1, zima 2021", "id:302408_5.0003.80303/1", "winter_wheat", "2021-01-15"),
    ("Swarzędz 2023 (mała działka), lipiec 2023", "id:302116_4.0001.2023", "potato", "2023-07-20"),
]


def run_case(case: tuple[str, str, str, str]) -> dict:
    title, point, crop, day = case
    where = ["--parcel", point[3:]] if point.startswith("id:") else ["--point", point]
    result: dict = {"title": title, "point": point, "crop": crop, "date": day}
    t0 = time.perf_counter()
    with tempfile.TemporaryDirectory(prefix="kowr-sweep-") as cache_dir:
        env = {**os.environ, "KOWR_CACHE_DIR": cache_dir, "KOWR_FAIL": "", "PYTHONIOENCODING": "utf-8"}
        if point.startswith("id:") and (ROOT / "cache" / "uldk").is_dir():
            shutil.copytree(ROOT / "cache" / "uldk", Path(cache_dir) / "uldk")
        try:
            proc = subprocess.run(
                [sys.executable, str(ROOT / "scripts" / "run_report.py"),
                 *where, "--crop", crop, "--date", day, "--json"],
                capture_output=True, text=True, encoding="utf-8", env=env, timeout=300)
        except subprocess.TimeoutExpired:
            return {**result, "outcome": "timeout", "wall_s": round(time.perf_counter() - t0, 1)}
    result["wall_s"] = round(time.perf_counter() - t0, 1)
    if proc.returncode != 0:
        tail = (proc.stderr or proc.stdout).strip().splitlines()
        return {**result, "outcome": "crash", "error": tail[-1][:400] if tail else "",
                "traceback": "\n".join(tail[-12:])}
    try:
        report = json.loads(proc.stdout[proc.stdout.index("{"):])
    except ValueError as exc:
        return {**result, "outcome": "bad_json", "error": str(exc)[:200]}
    parcel = report.get("parcel") or {}
    return {
        **result,
        "outcome": "ok",
        "elapsed_s": report.get("elapsed_s"),
        "timings_s": report.get("timings_s"),
        "parcel_id": parcel.get("id"),
        "area_ha": parcel.get("area_ha"),
        "headline": report["water_status"].get("headline") or report["water_status"].get("reason"),
        "sections": {name: report[name]["status"] for name in SECTIONS},
        "bad_sources": [
            {"key": s["key"], "status": s["status"], "reason": (s.get("reason") or "")[:200]}
            for s in report["sources"] if s["status"] != "ok"
        ],
        "recommendations": sum(len(report["recommendations"].get(k) or [])
                               for k in ("retention", "agrotechnical", "irrigation")),
        "limitations": len(report.get("limitations") or []),
    }


def describe(r: dict) -> str:
    head = f"=== {r['title']} | {r['point']} | {r['crop']} | {r['date']}"
    if r["outcome"] != "ok":
        return f"{head}\n   !! {r['outcome'].upper()} po {r.get('wall_s')} s: {r.get('error', '')}"
    slow = "  !! WOLNO" if (r["elapsed_s"] or 0) > SLOW_S else ""
    lines = [head,
             f"   działka {r['parcel_id']} ({r['area_ha']} ha) | raport {r['elapsed_s']} s{slow} | "
             f"rekomendacji {r['recommendations']} | ograniczeń {r['limitations']}",
             f"   czasy: {r['timings_s']}",
             f"   wynik: {r['headline']}",
             f"   sekcje: {r['sections']}"]
    lines += [f"   źródło {s['key']}: {s['status']} – {s['reason']}" for s in r["bad_sources"]]
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--workers", type=int, default=2, help="ile raportów naraz (domyślnie 2)")
    parser.add_argument("--out", help="plik JSONL z pełnymi wynikami przypadków")
    parser.add_argument("--only", help="tylko przypadki, których opis zawiera ten tekst")
    parser.add_argument("--cached-parcels", action="store_true",
                        help="zamiast punktów: działki z granicą zapisaną w cache/uldk (gdy ULDK ma awarię)")
    args = parser.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    cases = [c for c in (PARCEL_CASES if args.cached_parcels else CASES) if not args.only or args.only.lower() in c[0].lower()]
    results = []
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        for r in pool.map(run_case, cases):
            results.append(r)
            print(describe(r), flush=True)
    if args.out:
        Path(args.out).write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in results), encoding="utf-8")
    ok = [r for r in results if r["outcome"] == "ok"]
    slow = [r for r in ok if (r["elapsed_s"] or 0) > SLOW_S]
    times = sorted(r["elapsed_s"] for r in ok if r["elapsed_s"] is not None)
    print(f"\nRAZEM: {len(results)} przypadków, poprawnych {len(ok)}, "
          f"awarii {len(results) - len(ok)}, powyżej {SLOW_S:.0f} s: {len(slow)}")
    if times:
        print(f"czas raportu: mediana {times[len(times) // 2]} s, najdłuższy {times[-1]} s")


if __name__ == "__main__":
    main()
