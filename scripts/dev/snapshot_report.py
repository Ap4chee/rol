"""Zrzut raportów do JSON-ów, do porównania przed i po zmianie w kodzie (test regresji na prawdziwych danych).

Pola zależne od czasu wykonania (generated_at, elapsed_s, timings_s, from_cache i czasy w notatkach) są usuwane,
reszta ma zostać identyczna. Satelita dostaje pełny budżet z workera, żeby wynik nie zależał od tego,
czy archiwum zdjęć zdążyło w 14 s. Drugie uruchomienie korzysta z cache/ i trwa kilka sekund.

  python scripts/dev/snapshot_report.py <katalog_wyjściowy>
  diff -r przed/ po/
"""
from __future__ import annotations

import argparse
import asyncio
import json
import re
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from app.config import SATELLITE_DEFERRED_BUDGET_S  # noqa: E402
from app.report import build_report  # noqa: E402
from app.schemas import Point, ReportRequest  # noqa: E402

CASES = {
    "580_2_2018-07-15": ReportRequest(parcel_id="060910_2.0011.580/2", crop="winter_wheat", date=date(2018, 7, 15)),
    "580_2_2025-06-20": ReportRequest(parcel_id="060910_2.0011.580/2", crop="winter_wheat", date=date(2025, 6, 20)),
    # Wielkopolska, punkt bez numeru działki: inna gleba, inny wodowskaz, inna seria pogody
    "point_wlkp_2025-06-20": ReportRequest(point=Point(lon=17.05, lat=52.40), crop="maize", date=date(2025, 6, 20)),
}
# from_cache zależy od tego, czy to pierwsze uruchomienie, a nie od kodu
VOLATILE_KEYS = {"generated_at", "elapsed_s", "timings_s", "from_cache"}
# „Czas: szukanie 1,2 s, maski chmur 3,4 s” i „Pobranie 12,3 s” w notatkach źródeł zmieniają się przy każdym uruchomieniu
SECONDS = re.compile(r"\d+(,\d+)? s\b")


def scrub(value):
    if isinstance(value, dict):
        return {k: scrub(v) for k, v in value.items() if k not in VOLATILE_KEYS}
    if isinstance(value, list):
        return [scrub(v) for v in value]
    if isinstance(value, str):
        return SECONDS.sub("<t> s", value)
    return value


async def snapshot(out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    for name, request in CASES.items():
        report = await build_report(request, satellite_budget_s=SATELLITE_DEFERRED_BUDGET_S)
        data = scrub(report.model_dump(mode="json"))
        (out_dir / f"{name}.json").write_text(json.dumps(data, ensure_ascii=False, indent=1, sort_keys=True),
                                              encoding="utf-8")
        print(f"{name}: {report.water_status.class_key}, satelita {report.satellite.status.value}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("out_dir", type=Path)
    asyncio.run(snapshot(parser.parse_args().out_dir))


if __name__ == "__main__":
    main()
