"""Archiwalne prognozy ECMWF IFS (open data na AWS, s3://ecmwf-forecasts) dla skupisk -> ifs_forecast.parquet.

Do modelu wilgotności (dataset.py) potrzebna jest prognoza wydana w dniu t, a nie faktyczna pogoda.
Bierzemy przebieg 00 UTC z dnia t (w aplikacji dostępny rano tego dnia) i z każdego pliku kroku tylko potrzebne
pola, zapytaniem o zakres bajtów według pliku .index. Dni prognozy t jak w dataset.py (co ISSUE_STEP_DAYS od 1.01.2019).

Archiwum: od 18.01.2023 siatka 0,4° (`0p4-beta`) z opadem i temperaturą; od 02.2024 siatka 0,25° (`ifs/0p25`),
dodatkowo wilgotność gleby warstw 1–3 (0–7, 7–28, 28–100 cm, jak w ERA5-Land): `swvl1…3`, później `vsw` poziomy 1–3.
Pola (wartość w najbliższym węźle siatki, eccodes):
  krok 0                  wilgotność (analiza na dzień t)
  kroki 12, 36, …, 324    temperatura 2 m i wilgotność w połowie doby t+k (UTC)
  kroki 24, 48, …, 336    opad skumulowany od startu; opad doby t+k = tp(24k+24) − tp(24k)
HRES (`oper`) w archiwum kończy się na 240 h (od jesieni 2025 na 360 h); dalsze kroki z przebiegu kontrolnego
ensemble (`enfo`, type cf), który ma te same pola do 360 h (fetch_extension).
Doby prognozy są w UTC, a etykiety w Europe/Warsaw (1–2 h przesunięcia).
Dane: CC BY 4.0 i ECMWF Terms of Use (rejestr AWS Open Data, sprawdzone 22.11.2026).
Wynik: ifs_forecast.parquet: cluster, issue_date, lead (0…13), rain_mm, t2m_c, sm_0_100cm [m3/m3], sm_analysis [m3/m3], grid.
"""
from __future__ import annotations

import json
import time
from concurrent.futures import ProcessPoolExecutor
from datetime import date, timedelta

import httpx
import numpy as np

from kowr_ml.pipeline import config as C
from kowr_ml.pipeline.soil_moisture.dataset import HORIZON_DAYS, ISSUE_STEP_DAYS, SM_SEASONS

BASE = "https://ecmwf-forecasts.s3.amazonaws.com"
FIRST_DAY = date(2023, 1, 18)
LAYER_CM = (7, 21, 72)
SM_KEYS = ([("swvl1", None), ("swvl2", None), ("swvl3", None)], [("vsw", "1"), ("vsw", "2"), ("vsw", "3")])


def issue_dates() -> list[date]:
    t, out = date(min(SM_SEASONS), 1, 1), []
    while t.year <= max(SM_SEASONS):
        if t >= FIRST_DAY:
            out.append(t)
        t += timedelta(days=ISSUE_STEP_DAYS)
    return out


def steps() -> dict[int, list[str]]:
    """Krok [h] -> potrzebne pola ('sm' = trzy warstwy wilgotności)."""
    out = {0: ["sm"]}
    for k in HORIZON_DAYS:
        out.setdefault(24 * k + 12, []).extend(["2t", "sm"])
        out.setdefault(24 * k + 24, []).append("tp")
    return out


def read_step(client: httpx.Client, t: date, grid: str, stream: str, step: int, wanted: list[str]) -> dict | None:
    """Pola z jednego kroku przebiegu 00 UTC dnia t w węzłach skupisk ({'2t@36': [...], ...}); None, gdy kroku brak.

    stream 'oper' to prognoza główna (HRES), 'enfo' to ensemble, z którego bierzemy tylko przebieg kontrolny (type cf):
    HRES w archiwum sięga 240 h (od jesieni 2025 do 360 h), przebieg kontrolny ensemble 360 h.
    """
    import eccodes

    prefix = f"{BASE}/{t:%Y%m%d}/00z/{grid}/{stream}/{t:%Y%m%d}000000-{step}h-{stream}-{'fc' if stream == 'oper' else 'ef'}"
    r = client.get(f"{prefix}.index")
    if r.status_code != 200:
        return None
    idx = [e for e in (json.loads(line) for line in r.text.splitlines() if line.strip())
           if stream == "oper" or e.get("type") == "cf"]

    def find(param, level):
        return next((e for e in idx if e["param"] == param and (level is None or str(e.get("levelist")) == level)), None)

    keys = [(w, None) for w in wanted if w != "sm"]
    if "sm" in wanted:   # 0,4° nie ma wilgotności: wtedy brak tych pól (NaN w tabeli)
        keys += next((ks for ks in SM_KEYS if all(find(*k) for k in ks)), [])
    out = {}
    for param, level in keys:
        e = find(param, level)
        if e is None:
            continue
        gid = None
        for attempt in range(4):
            try:
                msg = client.get(f"{prefix}.grib2", headers={
                    "Range": f"bytes={e['_offset']}-{e['_offset'] + e['_length'] - 1}"}).content
                if len(msg) != e["_length"] or not msg.endswith(b"7777"):
                    raise ValueError(f"ucięta wiadomość GRIB ({len(msg)} z {e['_length']} B)")
                gid = eccodes.codes_new_from_message(msg)
                break
            except Exception as exc:  # sieć albo ucięta odpowiedź: ponów z odczekaniem
                err = exc
                time.sleep(3 * (attempt + 1))
        if gid is None:   # uszkodzone pole w archiwum: zostaje brak (NaN), reszta przebiegu się liczy
            print(f"{t} {stream} {param}{level or ''}@{step}: pominięte, {err}", flush=True)
            continue
        name = param if level is None else f"swvl{level}"   # vsw poziom N = swvlN
        out[f"{name}@{step}"] = [
            float(eccodes.codes_grib_find_nearest(gid, lat, lon)[0]["value"]) for _, lat, lon in C.CLUSTERS_FIRST]
        eccodes.codes_release(gid)
    return out


def fetch_run(t: date) -> dict | None:
    """Wartości pól w węzłach najbliższych środkom skupisk dla przebiegu 00 UTC z dnia t; None, gdy go brak."""
    with httpx.Client(timeout=120) as client:
        grid = next((res for res in ("ifs/0p25", "0p4-beta")
                     if client.get(f"{BASE}/{t:%Y%m%d}/00z/{res}/oper/{t:%Y%m%d}000000-0h-oper-fc.index").status_code == 200), None)
        if grid is None:
            return None
        out = {"grid": grid, "values": {}}
        for step, wanted in steps().items():
            out["values"].update(read_step(client, t, grid, "oper", step, wanted) or {})
    return out


def fetch_extension(t: date, base: dict) -> dict:
    """Kroki, których nie ma w zapisanym przebiegu `base` (dni 7–13 po wydłużeniu horyzontu z 7 do 14 dni).

    Krok bierzemy z HRES, a gdy go tam nie ma, z przebiegu kontrolnego ensemble (te same pola, ten sam start 00 UTC).
    Opad jest sumą od startu przebiegu, więc doba z ensemble potrzebuje też początku doby z ensemble: zapisujemy go
    jako 'tp@<krok>cf'. `cf_steps` mówi, które kroki są z ensemble.
    """
    have = {int(key.split("@")[1]) for key in base["values"]}
    out = {"values": {}, "cf_steps": []}
    with httpx.Client(timeout=120) as client:
        for step, wanted in steps().items():
            if step in have:
                continue
            got = read_step(client, t, base["grid"], "oper", step, wanted)
            if got is None:
                got = read_step(client, t, base["grid"], "enfo", step, wanted) or {}
                out["cf_steps"].append(step)
                start = step - 24
                if "tp" in wanted and start > 0 and start not in out["cf_steps"]:
                    tp0 = read_step(client, t, base["grid"], "enfo", start, ["tp"]) or {}
                    out["values"].update({f"tp@{start}cf": v for v in tp0.values()})
            out["values"].update(got)
    return out


def cached_run(t: date) -> str:
    path = C.DATA_DIR / "ifs_raw" / f"{t:%Y%m%d}.json"
    if not path.exists():
        run = fetch_run(t)
        path.write_text(json.dumps(run))
    return f"{t} {json.loads(path.read_text()) and 'ok' or 'brak przebiegu'}"


def cached_extension(t: date) -> str:
    """Dni dołożone po wydłużeniu horyzontu; osobny plik, żeby nie pobierać od nowa dni 0–6 z ifs_raw."""
    base = json.loads((C.DATA_DIR / "ifs_raw" / f"{t:%Y%m%d}.json").read_text())
    path = C.DATA_DIR / "ifs_raw_ext" / f"{t:%Y%m%d}.json"
    if base and not path.exists():
        path.write_text(json.dumps(fetch_extension(t, base)))
    return f"{t} {'dociągnięte' if base else 'brak przebiegu'}"


def root_zone_moisture(values: dict, missing: np.ndarray, step: int) -> np.ndarray:
    """Wilgotność 0–100 cm z warstw 1–3 ważona ich grubością, w węzłach skupisk dla kroku `step`."""
    layers = [values.get(f"swvl{i}@{step}", missing) for i in (1, 2, 3)]
    return sum(x * cm for x, cm in zip(layers, LAYER_CM)) / 100.0


def table():
    import pandas as pd

    rows = []
    for t in issue_dates():
        run = json.loads((C.DATA_DIR / "ifs_raw" / f"{t:%Y%m%d}.json").read_text())
        if not run:
            continue
        ext_path = C.DATA_DIR / "ifs_raw_ext" / f"{t:%Y%m%d}.json"
        ext = json.loads(ext_path.read_text()) if ext_path.exists() else {"values": {}, "cf_steps": []}
        v = {k: np.array(x) for k, x in {**run["values"], **ext["values"]}.items()}
        nan = np.full(len(C.CLUSTERS_FIRST), np.nan)
        for k in HORIZON_DAYS:
            end, start = 24 * k + 24, 24 * k
            # koniec doby z ensemble, a początek z HRES: początek też z ensemble (suma od startu tego samego przebiegu)
            from_cf = end in ext["cf_steps"] and start not in ext["cf_steps"]
            tp0 = v.get(f"tp@{start}cf" if from_cf else f"tp@{start}", nan) if k else np.zeros(len(C.CLUSTERS_FIRST))
            rain = (v.get(f"tp@{end}", nan) - tp0) * 1000.0   # m -> mm
            for c, (name, *_) in enumerate(C.CLUSTERS_FIRST):
                rows.append({"cluster": name, "issue_date": t.isoformat(), "lead": k, "grid": run["grid"],
                             "rain_mm": max(float(rain[c]), 0.0) if np.isfinite(rain[c]) else np.nan,
                             "t2m_c": float(v.get(f"2t@{24 * k + 12}", nan)[c]) - 273.15,
                             "sm_0_100cm": float(root_zone_moisture(v, nan, 24 * k + 12)[c]),
                             "sm_analysis": float(root_zone_moisture(v, nan, 0)[c])})
    return pd.DataFrame(rows)


def main() -> None:
    (C.DATA_DIR / "ifs_raw").mkdir(parents=True, exist_ok=True)
    (C.DATA_DIR / "ifs_raw_ext").mkdir(parents=True, exist_ok=True)
    dates = issue_dates()
    with ProcessPoolExecutor(16) as pool:
        for fetch in (cached_run, cached_extension):
            for i, msg in enumerate(pool.map(fetch, dates), 1):
                if i % 20 == 0 or i == len(dates):
                    print(f"{i}/{len(dates)} {msg}", flush=True)
    df = table()
    df.to_parquet(C.DATA_DIR / "ifs_forecast.parquet", index=False)
    print(df.groupby(["grid"]).agg(rows=("lead", "size"), rain_mm=("rain_mm", "mean"), t2m_c=("t2m_c", "mean"),
                                   sm=("sm_0_100cm", "mean"), sm_missing=("sm_0_100cm", lambda s: s.isna().mean())).to_string())


if __name__ == "__main__":
    main()
