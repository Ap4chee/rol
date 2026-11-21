"""Wodowskazy IMGW-PIB: bieżące pomiary (API danych publicznych) i archiwum dobowe.

Sprawdzone prawdziwymi wywołaniami 21.11.2026:
- `api/data/hydro/` (i `hydro2/`) zwraca aktywne wodowskazy ze współrzędnymi (`lon`, `lat`, EPSG:4326), ostatnim stanem
  wody [cm] i przepływem [m³/s] z datami pomiaru; wartości są napisami, brak = null,
- archiwum dobowe `dane_hydrologiczne/dobowe/<rok hydrologiczny>/`: do roku 2022 pliki miesięczne
  `codz_RRRR_WW.zip` (WW = miesiąc roku hydrologicznego, listopad = 01), od 2023 jeden plik roczny
  `codz_RRRR.zip` (ok. 1,9 MB, 23 MB CSV). Ostatni opublikowany rok to 2025 (do 31.10.2025),
- CSV w CP1250, pola: kod stacji, nazwa, rzeka, rok hydrol., miesiąc hydrol., dzień, stan [cm],
  przepływ [m³/s], temperatura, miesiąc kalendarzowy. Brak: 9999 / 99999.999 / pusto
  (od 2024 zawsze pusto). Kod stacji bywa poprzedzony spacją i w cudzysłowie albo bez.

Pliki archiwum są niezmienne, więc trzymamy je na dysku w `cache/imgw_zip/` (raz pobrane nie są pobierane
ponownie). Brak pliku (404) zapamiętujemy na dobę, bo IMGW dokłada kolejne lata.
"""
from __future__ import annotations

import asyncio
import io
import zipfile
from dataclasses import dataclass, field
from datetime import date, datetime

import httpx

from app import cache
from app.config import CACHE_DIR, TIMEOUT_HYDRO_S, check_forced_failure
from app.core import hydrology as calc
from app.sources import NoData, SourceError

# Oba adresy dają te same pola; 21.11.2026 `hydro2` zaczął okresowo zwracać pustą odpowiedź (200, 0 bajtów).
STATIONS_URLS = ("https://danepubliczne.imgw.pl/api/data/hydro/", "https://danepubliczne.imgw.pl/api/data/hydro2/")
ARCHIVE_URL = "https://danepubliczne.imgw.pl/data/dane_pomiarowo_obserwacyjne/dane_hydrologiczne/dobowe"
FIRST_YEARLY_FILE = 2023          # od tego roku hydrologicznego archiwum ma jeden plik na rok
STATIONS_MAX_AGE_S = 3 * 3600.0
MISSING_FILE_MAX_AGE_S = 24 * 3600.0
MAX_DISTANCE_KM = 40.0
MAX_CANDIDATES = 4
LIVE_MAX_AGE_DAYS = 2             # bieżący pomiar starszy niż tyle dni nie opisuje daty analizy
TIMEOUT_ARCHIVE_FILE_S = 20.0
METRIC_PL = {"flow": "przepływ", "level": "stan wody"}

ATTRIBUTION = ("Źródłem pochodzenia danych jest Instytut Meteorologii i Gospodarki Wodnej – Państwowy Instytut "
               "Badawczy. Dane Instytutu Meteorologii i Gospodarki Wodnej – Państwowego Instytutu Badawczego "
               "zostały przetworzone.")


@dataclass
class Station:
    id: str
    name: str
    river: str
    lon: float
    lat: float
    level_cm: float | None
    level_time: datetime | None
    flow_m3s: float | None
    flow_time: datetime | None
    distance_km: float = 0.0


@dataclass
class HydroResult:
    station: Station
    metric: str                        # flow | level
    unit: str                          # m³/s | cm
    origin: str                        # archive (średnia z 7 dni) | live (bieżący pomiar)
    current_from: date
    current_to: date
    comparison: calc.Comparison
    archive_to: date | None            # ostatni dzień opublikowanego archiwum
    from_cache: bool
    notes: list[str] = field(default_factory=list)
    stations_checked: list[str] = field(default_factory=list)


def _num(value) -> float | None:
    if value in (None, ""):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _time(value) -> datetime | None:
    try:
        return datetime.strptime(value, "%Y-%m-%d %H:%M:%S") if value else None
    except ValueError:
        return None


def parse_stations(payload: list[dict]) -> list[Station]:
    out = []
    for row in payload:
        lon, lat = _num(row.get("lon")), _num(row.get("lat"))
        if lon is None or lat is None or not row.get("id_stacji"):
            continue
        out.append(Station(
            id=str(row["id_stacji"]).strip(), name=str(row.get("stacja") or "").strip(),
            river=str(row.get("rzeka") or "").strip(), lon=lon, lat=lat,
            level_cm=_num(row.get("stan_wody")), level_time=_time(row.get("stan_wody_data_pomiaru")),
            flow_m3s=_num(row.get("przeplyw")), flow_time=_time(row.get("przeplyw_data"))))
    return out


async def fetch_stations(client: httpx.AsyncClient) -> tuple[list[Station], bool]:
    """Aktywne wodowskazy z ostatnimi pomiarami. Drugi element: czy z pamięci podręcznej."""
    cached = cache.get("imgw_hydro", "stations", max_age_s=STATIONS_MAX_AGE_S)
    if cached is not None:
        return parse_stations(cached), True
    errors = []
    for url in STATIONS_URLS:
        try:
            response = await client.get(url, timeout=TIMEOUT_HYDRO_S)
            response.raise_for_status()
            payload = response.json() if response.content else None
        except (httpx.HTTPError, ValueError) as exc:
            errors.append(type(exc).__name__)
            continue
        if isinstance(payload, list) and payload:
            cache.put("imgw_hydro", "stations", payload)
            return parse_stations(payload), False
        errors.append("pusta odpowiedź")
    raise SourceError(f"API danych publicznych IMGW nie zwróciło listy wodowskazów ({', '.join(errors)})")


def nearest(stations: list[Station], lon: float, lat: float,
            max_km: float = MAX_DISTANCE_KM, limit: int = MAX_CANDIDATES) -> list[Station]:
    for s in stations:
        s.distance_km = calc.distance_km(lon, lat, s.lon, s.lat)
    return sorted((s for s in stations if s.distance_km <= max_km), key=lambda s: s.distance_km)[:limit]


# ---------- archiwum dobowe ----------

MAX_PARALLEL_DOWNLOADS = 3
_semaphores: dict[int, asyncio.Semaphore] = {}


def _download_slots() -> asyncio.Semaphore:
    """Ogranicznik równoległych pobrań archiwum (osobny dla każdej pętli zdarzeń)."""
    loop_id = id(asyncio.get_running_loop())
    if loop_id not in _semaphores:
        _semaphores[loop_id] = asyncio.Semaphore(MAX_PARALLEL_DOWNLOADS)
    return _semaphores[loop_id]


def archive_file_name(hydro_year: int, month: int) -> str:
    if hydro_year >= FIRST_YEARLY_FILE:
        return f"codz_{hydro_year}.zip"
    return f"codz_{hydro_year}_{month:02d}.zip"


async def fetch_archive_file(client: httpx.AsyncClient, hydro_year: int, name: str) -> tuple[bytes | None, bool]:
    """Plik archiwum (bajty zip) albo None, gdy IMGW go jeszcze nie opublikował. Drugi element: z dysku."""
    path = CACHE_DIR / "imgw_zip" / name
    if path.exists():
        return path.read_bytes(), True
    if cache.get("imgw_missing", name, max_age_s=MISSING_FILE_MAX_AGE_S):
        return None, True
    url = f"{ARCHIVE_URL}/{hydro_year}/{name}"
    response = None
    async with _download_slots():
        for attempt in range(2):   # serwer IMGW przy wielu równoległych zapytaniach gubi połączenia: jedna ponowna próba
            try:
                response = await client.get(url, timeout=TIMEOUT_ARCHIVE_FILE_S)
                break
            except httpx.HTTPError as exc:
                if attempt == 1:
                    raise SourceError(f"archiwum IMGW nie odpowiedziało przy pliku {name} ({type(exc).__name__})") from exc
    if response.status_code == 404:
        cache.put("imgw_missing", name, True)
        return None, False
    if response.status_code != 200:
        raise SourceError(f"archiwum IMGW zwróciło kod {response.status_code} przy pliku {name}")
    data = response.content
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        tmp.write_bytes(data)
        tmp.replace(path)
    except OSError:
        pass
    return data, False


def parse_archive_line(line: str) -> tuple[str, date, float | None, float | None] | None:
    """Jeden wiersz CSV archiwum: (kod stacji, dzień, stan [cm], przepływ [m³/s]).

    Format różni się między latami (2023: średniki; 2024: cały wiersz w cudzysłowie; wcześniej pola
    tekstowe w cudzysłowie). Cudzysłowy usuwamy, a pola liczbowe czytamy od końca wiersza, bo nazwa
    stacji lub rzeki mogłaby zawierać separator.
    """
    clean = line.replace('"', "").lstrip("﻿ï»¿").strip()
    fields = [f.strip() for f in clean.split(";" if ";" in clean else ",")]
    if len(fields) < 10:
        return None
    hy, _month_h, day, level, flow, _temp, month = fields[-7:]
    try:
        hydro_year, day_i, month_i = int(hy), int(day), int(month)
        d = date(hydro_year - 1 if month_i >= 11 else hydro_year, month_i, day_i)
    except ValueError:
        return None
    return fields[0], d, _num(level), _num(flow)


def parse_archive(data: bytes, station_ids: set[str]) -> dict[str, dict[str, dict[date, float]]]:
    """Dobowe serie {stacja: {"level": {dzień: cm}, "flow": {dzień: m³/s}}} dla wybranych stacji."""
    out: dict[str, dict[str, dict[date, float]]] = {sid: {"level": {}, "flow": {}} for sid in station_ids}
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        for member in zf.namelist():
            # Kodowanie bywa różne (CP1250, UTF-8 z BOM), ale potrzebne pola są liczbowe, więc wystarcza latin-1.
            text = zf.read(member).decode("latin-1")
            for line in text.splitlines():
                if not any(sid in line for sid in station_ids):
                    continue
                row = parse_archive_line(line)
                if row is None or row[0] not in out:
                    continue
                sid, d, level, flow = row
                if level is not None and level < 9999:
                    out[sid]["level"][d] = level
                if flow is not None and flow < 99999:
                    out[sid]["flow"][d] = flow
    return out


def needed_files(end: date, years_back: int) -> dict[str, int]:
    """Pliki archiwum (nazwa → rok hydrologiczny) obejmujące okno 7 dni w roku analizy i w latach odniesienia."""
    files: dict[str, int] = {}
    for year in range(end.year - years_back, end.year + 1):
        for d in calc.window_days(calc.same_day_in_year(end, year)):
            hy, month = calc.hydro_year_month(d)
            files[archive_file_name(hy, month)] = hy
    return files


def _live_value(station: Station, metric: str, analysis_date: date, today: date) -> tuple[float, date] | None:
    """Bieżący pomiar, jeśli dotyczy daty analizy (analiza „na dziś”, pomiar z ostatnich dni)."""
    value, when = (station.flow_m3s, station.flow_time) if metric == "flow" else (station.level_cm, station.level_time)
    if value is None or when is None or (today - analysis_date).days > 1:
        return None
    if (today - when.date()).days > LIVE_MAX_AGE_DAYS:
        return None
    return value, when.date()


async def fetch_hydrology(client: httpx.AsyncClient, lon: float, lat: float, analysis_date: date, today: date,
                          years_back: int) -> HydroResult:
    """Najbliższy wodowskaz z danymi i porównanie z tymi samymi dniami w poprzednich latach.

    Zgłasza NoData, gdy w promieniu 40 km nie ma wodowskazu z danymi dla daty analizy, i SourceError przy awarii.
    """
    check_forced_failure("hydrology")
    stations, stations_cached = await fetch_stations(client)
    candidates = nearest(stations, lon, lat)
    if not candidates:
        raise NoData(f"W promieniu {MAX_DISTANCE_KM:.0f} km od działki nie ma czynnego wodowskazu IMGW.")

    files = needed_files(analysis_date, years_back)
    results = await asyncio.gather(*(fetch_archive_file(client, hy, name) for name, hy in files.items()),
                                   return_exceptions=True)
    ids = {s.id for s in candidates}
    series: dict[str, dict[str, dict[date, float]]] = {sid: {"level": {}, "flow": {}} for sid in ids}
    all_cached, missing, failed = stations_cached, [], []
    for (name, _hy), result in zip(files.items(), results):
        if isinstance(result, Exception):
            failed.append(str(result))
            continue
        data, from_disk = result
        all_cached = all_cached and from_disk
        if data is None:
            missing.append(name)
            continue
        parsed = await asyncio.to_thread(parse_archive, data, ids)
        for sid, by_metric in parsed.items():
            for metric, values in by_metric.items():
                series[sid][metric].update(values)
    if failed and len(failed) == len(files):
        raise SourceError(failed[0])

    archive_days = [d for s in series.values() for m in s.values() for d in m]
    archive_to = max(archive_days) if archive_days else None
    checked: list[str] = []
    for metric, unit in (("flow", "m³/s"), ("level", "cm")):
        for station in candidates:
            data = series[station.id][metric]
            reference = calc.reference_values(data, analysis_date, years_back)
            current = calc.window_mean(data, analysis_date)
            origin, current_from, current_to = "archive", calc.window_days(analysis_date)[0], analysis_date
            if current is None:
                live = _live_value(station, metric, analysis_date, today)
                if live is None:
                    checked.append(f"{station.name} ({METRIC_PL[metric]}): brak pomiaru dla daty analizy")
                    continue
                current, current_to = live
                current_from, origin = current_to, "live"
            comparison = calc.compare(current, reference)
            if comparison is None:
                checked.append(f"{station.name} ({METRIC_PL[metric]}): za mało lat do porównania ({len(reference)})")
                continue
            notes = []
            if missing:
                notes.append("Archiwum nie obejmuje jeszcze części dni (pliki nieopublikowane: "
                             + ", ".join(sorted(missing)) + ").")
            if failed:
                notes.append(f"Nie pobrano {len(failed)} plików archiwum: {failed[0]}.")
            return HydroResult(station=station, metric=metric, unit=unit, origin=origin, current_from=current_from,
                               current_to=current_to, comparison=comparison, archive_to=archive_to,
                               from_cache=all_cached, notes=notes, stations_checked=checked)

    until = f" (archiwum IMGW kończy się {archive_to.strftime('%d.%m.%Y')}" if archive_to else " ("
    until += ", a bieżący pomiar opisuje tylko dzień dzisiejszy)" if archive_to else "brak archiwum)"
    raise NoData(f"Żaden z {len(candidates)} najbliższych wodowskazów nie ma pomiarów dla tej daty{until}. "
                 + "; ".join(checked[:4]) + ".")
