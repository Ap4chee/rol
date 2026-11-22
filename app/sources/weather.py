"""Pogoda dzienna: opad [mm], ET0 [mm], Tmin i Tmax [°C] z dwóch dostawców o wspólnym wyniku.

Kolejność: Open-Meteo Archive (ERA5) → przy 429, błędzie lub przekroczeniu czasu NASA POWER.
Cała wieloletnia seria pochodzi z jednego dostawcy, żeby mediany były spójne.
Ostatnie dni, których archiwum jeszcze nie ma, są dobierane z Open-Meteo Forecast (`past_days`)
i oznaczone w polu `origin` każdego dnia.

Sprawdzone prawdziwymi wywołaniami 21.11.2026:
- archive-api.open-meteo.com zwraca z sieci hackathonu 429 „Daily API request limit exceeded”,
- NASA POWER: 11 lat w ok. 1,7 s, brak danych = wartość `fill_value` (−999), ostatnie 3 dni puste,
  promieniowanie puste przez ok. 6 dni,
- api.open-meteo.com/v1/forecast z `past_days` działa (do 92 dni wstecz).

Funkcje są importowalne poza aplikacją (np. do przygotowania danych treningowych).
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from datetime import date, timedelta

import httpx
import numpy as np

from app import cache
from app.config import (
    TIMEOUT_WEATHER_ARCHIVE_S,
    TIMEOUT_WEATHER_POWER_S,
    TIMEOUT_WEATHER_RECENT_S,
    check_forced_failure,
)
from app.core.et0 import actual_vapour_pressure_from_rh_mean_kpa, et0_fao56_mm_day
from app.schemas import ForecastDay, ForecastResponse, Status
from app.sources import NoData, SourceError

OPEN_METEO_ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
OPEN_METEO_FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
NASA_POWER_URL = "https://power.larc.nasa.gov/api/temporal/daily/point"
NASA_POWER_PARAMETERS = "PRECTOTCORR,T2M_MAX,T2M_MIN,ALLSKY_SFC_SW_DWN,WS2M,RH2M"
OPEN_METEO_DAILY = "precipitation_sum,et0_fao_evapotranspiration,temperature_2m_max,temperature_2m_min"

FORECAST_MAX_PAST_DAYS = 92
FORECAST_MAX_DAYS = 16
RECENT_CACHE_MAX_AGE_S = 3600.0
# Po odmowie (np. 429) nie pytamy tego samego dostawcy ponownie przez 10 minut.
_NEGATIVE_TTL_S = 600.0
_negative: dict[str, tuple[float, str]] = {}

PROVIDERS = {
    "open_meteo_archive": {
        "name": "Open-Meteo Archive (reanaliza ERA5 / ERA5-Land, ECMWF IFS)",
        "resolution": "siatka modelu ok. 9–25 km (wartość dla komórki, nie pomiar w punkcie)",
        "license": "dane CC BY 4.0; darmowy dostęp do API tylko niekomercyjny",
        "url": "https://open-meteo.com/en/docs/historical-weather-api",
    },
    "nasa_power": {
        "name": "NASA POWER (meteorologia MERRA-2, promieniowanie CERES); ET0 liczone wzorem FAO-56",
        "resolution": "siatka 0,5° × 0,625° (ok. 55 × 45 km) dla meteorologii, 1° × 1° dla promieniowania",
        "license": "dane NASA udostępniane bezpłatnie i bez ograniczeń (szczegóły w README)",
        "url": "https://power.larc.nasa.gov/docs/",
    },
    "open_meteo_forecast": {
        "name": "Open-Meteo Forecast (analiza modeli pogody z ostatnich dni)",
        "resolution": "siatka modelu ok. 2–11 km",
        "license": "dane CC BY 4.0; darmowy dostęp do API tylko niekomercyjny",
        "url": "https://open-meteo.com/en/docs",
    },
}


@dataclass
class DailyWeather:
    """Ciąg kolejnych dni. Brak wartości = NaN."""
    dates: list[date]
    rain_mm: np.ndarray
    et0_mm: np.ndarray
    tmin_c: np.ndarray
    tmax_c: np.ndarray
    origin: list[str]  # klucz dostawcy dla każdego dnia ("" gdy brak danych)

    def complete(self) -> np.ndarray:
        return np.isfinite(self.rain_mm) & np.isfinite(self.et0_mm)

    def last_complete_index(self) -> int:
        idx = np.nonzero(self.complete())[0]
        return int(idx[-1]) if len(idx) else -1


@dataclass
class Attempt:
    """Jedna próba pobrania: do wpisu w źródłach raportu."""
    provider: str
    ok: bool
    reason: str | None = None
    elapsed_s: float = 0.0
    from_cache: bool = False
    data_from: date | None = None
    data_to: date | None = None
    notes: list[str] = field(default_factory=list)


@dataclass
class WeatherResult:
    series: DailyWeather | None
    provider: str | None
    attempts: list[Attempt]
    filled_days: int = 0
    interpolated_et0_days: int = 0
    missing_rain_days: int = 0


def snap(value: float) -> float:
    """Współrzędna zaokrąglona do 0,01° (ok. 1 km): klucz komórki cache i punkt zapytania."""
    return round(value, 2)


def _date_range(start: date, end: date) -> list[date]:
    return [start + timedelta(days=i) for i in range((end - start).days + 1)]


def _to_array(values: list, n: int) -> np.ndarray:
    out = np.full(n, np.nan)
    for i, v in enumerate(values[:n]):
        if v is not None:
            out[i] = float(v)
    return out


# ---------- Open-Meteo Archive ----------

def parse_open_meteo_daily(payload: dict, provider: str) -> DailyWeather:
    daily = payload.get("daily") or {}
    times = daily.get("time") or []
    if not times:
        raise NoData("Open-Meteo nie zwróciło dni w odpowiedzi")
    dates = [date.fromisoformat(t) for t in times]
    n = len(dates)
    rain = _to_array(daily.get("precipitation_sum") or [], n)
    et0 = _to_array(daily.get("et0_fao_evapotranspiration") or [], n)
    tmin = _to_array(daily.get("temperature_2m_min") or [], n)
    tmax = _to_array(daily.get("temperature_2m_max") or [], n)
    ok = np.isfinite(rain) & np.isfinite(et0)
    return DailyWeather(dates, rain, et0, tmin, tmax, [provider if o else "" for o in ok])


async def _get_json(client: httpx.AsyncClient, url: str, params: dict, timeout_s: float, label: str) -> dict:
    try:
        response = await client.get(url, params=params, timeout=timeout_s)
    except httpx.TimeoutException as exc:
        raise SourceError(f"{label}: brak odpowiedzi w {timeout_s:.0f} s") from exc
    except httpx.HTTPError as exc:
        raise SourceError(f"{label}: błąd połączenia ({type(exc).__name__})") from exc
    if response.status_code == 429:
        raise SourceError(f"{label}: HTTP 429, przekroczony limit zapytań z tego adresu IP")
    if response.status_code != 200:
        raise SourceError(f"{label}: HTTP {response.status_code}")
    try:
        return response.json()
    except ValueError as exc:
        raise SourceError(f"{label}: odpowiedź nie jest poprawnym JSON") from exc


async def fetch_open_meteo_archive(client: httpx.AsyncClient, lat: float, lon: float,
                                   start: date, end: date) -> tuple[DailyWeather, bool]:
    """Seria dzienna z archiwum Open-Meteo. Zwraca (seria, czy_z_cache)."""
    lat, lon = snap(lat), snap(lon)
    key = f"om_archive:{lat:.2f},{lon:.2f}:{start}:{end}"
    cached = cache.get("weather", key)
    if cached:
        return parse_open_meteo_daily(cached, "open_meteo_archive"), True
    check_forced_failure("weather_archive")
    payload = await _get_json(client, OPEN_METEO_ARCHIVE_URL, {
        "latitude": lat, "longitude": lon, "start_date": start.isoformat(), "end_date": end.isoformat(),
        "daily": OPEN_METEO_DAILY, "timezone": "Europe/Warsaw",
    }, TIMEOUT_WEATHER_ARCHIVE_S, "Open-Meteo Archive")
    series = parse_open_meteo_daily(payload, "open_meteo_archive")
    cache.put("weather", key, {"daily": payload.get("daily"), "elevation": payload.get("elevation"),
                               "latitude": payload.get("latitude"), "longitude": payload.get("longitude")})
    return series, False


# ---------- NASA POWER ----------

def parse_nasa_power(payload: dict, lat: float) -> DailyWeather:
    """Seria dzienna z odpowiedzi NASA POWER. ET0 liczone wzorem FAO-56 Penmana-Monteitha."""
    try:
        params = payload["properties"]["parameter"]
        elevation_m = float(payload["geometry"]["coordinates"][2])
    except (KeyError, IndexError, TypeError, ValueError) as exc:
        raise SourceError("NASA POWER: nieoczekiwany układ odpowiedzi") from exc
    fill = float((payload.get("header") or {}).get("fill_value", -999.0))
    keys = sorted(params.get("PRECTOTCORR", {}).keys())
    if not keys:
        raise NoData("NASA POWER nie zwróciło dni w odpowiedzi")
    dates = [date(int(k[:4]), int(k[4:6]), int(k[6:8])) for k in keys]

    def column(name: str) -> np.ndarray:
        src = params.get(name, {})
        arr = np.array([float(src.get(k, fill)) for k in keys])
        arr[arr == fill] = np.nan
        return arr

    rain = column("PRECTOTCORR")            # mm/dobę
    tmax = column("T2M_MAX")                # °C
    tmin = column("T2M_MIN")                # °C
    rs = column("ALLSKY_SFC_SW_DWN")        # MJ m-2 doba-1 (community=AG)
    u2 = column("WS2M")                     # m/s na 2 m
    rh = column("RH2M")                     # %
    doy = np.array([d.timetuple().tm_yday for d in dates])
    ea = actual_vapour_pressure_from_rh_mean_kpa(tmax, tmin, rh)
    et0 = et0_fao56_mm_day(tmax, tmin, rs, u2, ea, lat_deg=lat, elevation_m=elevation_m, day_of_year=doy)
    rain = np.where(np.isfinite(rain), np.maximum(rain, 0.0), np.nan)
    ok = np.isfinite(rain) & np.isfinite(et0)
    return DailyWeather(dates, rain, et0, tmin, tmax, ["nasa_power" if o else "" for o in ok])


async def fetch_nasa_power(client: httpx.AsyncClient, lat: float, lon: float,
                           start: date, end: date) -> tuple[DailyWeather, bool]:
    """Seria dzienna z NASA POWER. Zwraca (seria, czy_z_cache)."""
    lat, lon = snap(lat), snap(lon)
    key = f"nasa_power:{lat:.2f},{lon:.2f}:{start}:{end}"
    cached = cache.get("weather", key)
    if cached:
        return parse_nasa_power(cached, lat), True
    check_forced_failure("weather_power")
    payload = await _get_json(client, NASA_POWER_URL, {
        "parameters": NASA_POWER_PARAMETERS, "community": "AG", "longitude": lon, "latitude": lat,
        "start": start.strftime("%Y%m%d"), "end": end.strftime("%Y%m%d"), "format": "JSON",
    }, TIMEOUT_WEATHER_POWER_S, "NASA POWER")
    series = parse_nasa_power(payload, lat)
    cache.put("weather", key, {"properties": {"parameter": payload["properties"]["parameter"]},
                               "geometry": payload["geometry"], "header": payload.get("header")})
    return series, False


# ---------- ostatnie dni z Open-Meteo Forecast ----------

async def fetch_open_meteo_recent(client: httpx.AsyncClient, lat: float, lon: float,
                                  past_days: int, today: date) -> tuple[DailyWeather, bool]:
    lat, lon = snap(lat), snap(lon)
    past_days = min(max(past_days, 1), FORECAST_MAX_PAST_DAYS)
    key = f"om_recent:{lat:.2f},{lon:.2f}:{today}:{past_days}"
    cached = cache.get("weather", key, max_age_s=RECENT_CACHE_MAX_AGE_S)
    if cached:
        return parse_open_meteo_daily(cached, "open_meteo_forecast"), True
    check_forced_failure("weather_recent")
    payload = await _get_json(client, OPEN_METEO_FORECAST_URL, {
        "latitude": lat, "longitude": lon, "past_days": past_days, "forecast_days": 1,
        "daily": OPEN_METEO_DAILY, "timezone": "Europe/Warsaw",
    }, TIMEOUT_WEATHER_RECENT_S, "Open-Meteo Forecast")
    series = parse_open_meteo_daily(payload, "open_meteo_forecast")
    cache.put("weather", key, {"daily": payload.get("daily")})
    return series, False


# ---------- prognoza na pulpit i zakładkę Pogoda ----------

def parse_dashboard_forecast(payload: dict, today: date, forecast_days: int = 7) -> ForecastResponse:
    daily = payload.get("daily") if isinstance(payload, dict) else None
    if not isinstance(daily, dict) or not isinstance(daily.get("time"), list):
        raise NoData("Prognoza nie zawiera danych dziennych.")

    horizon = min(max(forecast_days, 1), FORECAST_MAX_DAYS)

    def read(field: str, i: int) -> float | None:
        values = daily.get(field)
        if isinstance(values, list) and i < len(values):
            value = values[i]
            if isinstance(value, (int, float)) and not isinstance(value, bool) and np.isfinite(value):
                return value
        return None

    rows = {}
    past = {}
    recent = []
    for i, iso_date in enumerate(daily["time"]):
        try:
            day = date.fromisoformat(iso_date)
        except (ValueError, TypeError):
            continue
        precip = read("precipitation_sum", i)
        ahead = (day - today).days
        if -30 <= ahead < 0:
            past[day] = precip
            recent.append(ForecastDay(date=day, precipitation_mm=precip, et0_mm=read("et0_fao_evapotranspiration", i)))
        if 0 <= ahead < horizon:
            code = read("weather_code", i)
            rows[day] = ForecastDay(
                date=day, temperature_max_c=read("temperature_2m_max", i),
                temperature_min_c=read("temperature_2m_min", i),
                precipitation_mm=precip, et0_mm=read("et0_fao_evapotranspiration", i),
                weather_code=int(code) if code is not None else None, wind_max_kmh=read("wind_speed_10m_max", i),
            )
    if not rows or not any(row.temperature_max_c is not None or row.precipitation_mm is not None
                           for row in rows.values()):
        raise NoData("Dla tej lokalizacji brakuje wartości prognozy.")
    last_wet_day = max((day for day, rain in past.items() if rain is not None and rain > 5), default=None)
    return ForecastResponse(
        status=Status.ok,
        days=[rows.get(day) or ForecastDay(date=day) for day in (today + timedelta(days=i) for i in range(horizon))],
        recent=sorted(recent, key=lambda row: row.date), last_wet_day=last_wet_day,
        past_days_complete=len(past) == 30 and all(rain is not None for rain in past.values()),
    )


async def fetch_dashboard_forecast(client: httpx.AsyncClient, lat: float, lon: float,
                                   today: date, days: int = FORECAST_MAX_DAYS) -> ForecastResponse:
    lat, lon = snap(lat), snap(lon)
    horizon = min(max(days, 1), FORECAST_MAX_DAYS)
    key = f"om_forecast16_v2:{lat:.2f},{lon:.2f}:{today}"   # v2: wiatr, Tmin i ostatnie 30 dni w odpowiedzi
    cached = cache.get("weather", key, max_age_s=RECENT_CACHE_MAX_AGE_S)
    if cached is not None:
        forecast = ForecastResponse.model_validate(cached)
        return forecast.model_copy(update={"days": forecast.days[:horizon]})
    payload = await _get_json(client, OPEN_METEO_FORECAST_URL, {
        "latitude": lat, "longitude": lon, "past_days": 30, "forecast_days": FORECAST_MAX_DAYS,
        "daily": OPEN_METEO_DAILY + ",weather_code,wind_speed_10m_max", "timezone": "Europe/Warsaw",
    }, TIMEOUT_WEATHER_RECENT_S, "Open-Meteo Forecast")
    forecast = parse_dashboard_forecast(payload, today, forecast_days=FORECAST_MAX_DAYS)
    cache.put("weather", key, forecast.model_dump(mode="json"))
    return forecast.model_copy(update={"days": forecast.days[:horizon]})


# ---------- składanie serii ----------

def align(series: DailyWeather, start: date, end: date) -> DailyWeather:
    """Przycina albo uzupełnia serię do zakresu [start, end]; brakujące dni mają NaN."""
    dates = _date_range(start, end)
    n = len(dates)
    out = DailyWeather(dates, np.full(n, np.nan), np.full(n, np.nan), np.full(n, np.nan), np.full(n, np.nan), [""] * n)
    index = {d: i for i, d in enumerate(series.dates)}
    for j, d in enumerate(dates):
        i = index.get(d)
        if i is not None:
            out.rain_mm[j], out.et0_mm[j] = series.rain_mm[i], series.et0_mm[i]
            out.tmin_c[j], out.tmax_c[j] = series.tmin_c[i], series.tmax_c[i]
            out.origin[j] = series.origin[i]
    return out


def fill_from(base: DailyWeather, extra: DailyWeather) -> int:
    """Wpisuje do `base` dni, których w nim brakuje, a które są kompletne w `extra`. Zwraca liczbę dni."""
    index = {d: i for i, d in enumerate(extra.dates)}
    filled = 0
    for j, d in enumerate(base.dates):
        if np.isfinite(base.rain_mm[j]) and np.isfinite(base.et0_mm[j]):
            continue
        i = index.get(d)
        if i is None or not (np.isfinite(extra.rain_mm[i]) and np.isfinite(extra.et0_mm[i])):
            continue
        base.rain_mm[j], base.et0_mm[j] = extra.rain_mm[i], extra.et0_mm[i]
        base.tmin_c[j], base.tmax_c[j] = extra.tmin_c[i], extra.tmax_c[i]
        base.origin[j] = extra.origin[i]
        filled += 1
    return filled


def trim_to_last_complete(series: DailyWeather) -> DailyWeather:
    last = series.last_complete_index()
    n = last + 1
    return DailyWeather(series.dates[:n], series.rain_mm[:n], series.et0_mm[:n],
                        series.tmin_c[:n], series.tmax_c[:n], series.origin[:n])


def repair_interior_gaps(series: DailyWeather) -> tuple[int, int]:
    """Pojedyncze braki w środku serii: ET0 interpolowane liniowo, opad przyjęty jako 0 mm.

    Zwraca (liczba dni z interpolowanym ET0, liczba dni z nieznanym opadem). Obie liczby trafiają
    do raportu, bo to jest wstawienie wartości w miejsce braku.
    """
    n = len(series.dates)
    if n == 0:
        return 0, 0
    x = np.arange(n)
    et0_missing = ~np.isfinite(series.et0_mm)
    if et0_missing.any() and (~et0_missing).any():
        series.et0_mm[et0_missing] = np.interp(x[et0_missing], x[~et0_missing], series.et0_mm[~et0_missing])
    rain_missing = ~np.isfinite(series.rain_mm)
    series.rain_mm[rain_missing] = 0.0
    for i in np.nonzero(et0_missing | rain_missing)[0]:
        series.origin[int(i)] = (series.origin[int(i)] or "uzupełnione") + "+uzupełnione"
    return int(et0_missing.sum()), int(rain_missing.sum())


async def fetch_weather(client: httpx.AsyncClient, lat: float, lon: float,
                        start: date, end: date, today: date) -> WeatherResult:
    """Seria dzienna dla [start, end] z pierwszego działającego dostawcy archiwum, z doborem ostatnich dni.

    `end` to ostatni dzień, który może wejść do obliczeń (nigdy późniejszy niż data analizy).
    """
    attempts: list[Attempt] = []
    base: DailyWeather | None = None
    provider: str | None = None

    for name, fetch in (("open_meteo_archive", fetch_open_meteo_archive), ("nasa_power", fetch_nasa_power)):
        blocked = _negative.get(name)
        if blocked and time.time() - blocked[0] < _NEGATIVE_TTL_S:
            attempts.append(Attempt(name, False, blocked[1] + " (odmowa sprzed chwili, nie ponawiano)"))
            continue
        t0 = time.perf_counter()
        try:
            raw, from_cache = await fetch(client, lat, lon, start, end)
            aligned = align(raw, start, end)
            if aligned.last_complete_index() < 0:
                raise NoData("brak kompletnych dni w odpowiedzi")
        except (SourceError, NoData, RuntimeError) as exc:
            reason = str(exc)
            attempts.append(Attempt(name, False, reason, round(time.perf_counter() - t0, 2)))
            if "429" in reason:
                _negative[name] = (time.time(), reason)
            continue
        last = aligned.dates[aligned.last_complete_index()]
        attempts.append(Attempt(name, True, None, round(time.perf_counter() - t0, 2), from_cache,
                                data_from=start, data_to=last))
        base, provider = aligned, name
        break

    if base is None:
        return WeatherResult(None, None, attempts)

    filled = 0
    last_complete = base.dates[base.last_complete_index()]
    if last_complete < end:
        gap_start = last_complete + timedelta(days=1)
        past_days = (today - gap_start).days + 1
        if 0 < past_days <= FORECAST_MAX_PAST_DAYS:
            t0 = time.perf_counter()
            try:
                recent, from_cache = await fetch_open_meteo_recent(client, lat, lon, past_days, today)
                filled = fill_from(base, recent)
                days = [d for d, o in zip(base.dates, base.origin) if o == "open_meteo_forecast"]
                attempts.append(Attempt(
                    "open_meteo_forecast", filled > 0,
                    None if filled else "brak kompletnych dni do uzupełnienia",
                    round(time.perf_counter() - t0, 2), from_cache,
                    data_from=days[0] if days else None, data_to=days[-1] if days else None,
                    notes=[f"Uzupełniono {filled} ostatnich dni, których archiwum jeszcze nie ma."] if filled else []))
            except (SourceError, NoData, RuntimeError) as exc:
                attempts.append(Attempt("open_meteo_forecast", False, str(exc), round(time.perf_counter() - t0, 2)))
        else:
            attempts.append(Attempt("open_meteo_forecast", False,
                                    "archiwum kończy się wcześniej niż data analizy, a brakujące dni są starsze "
                                    f"niż {FORECAST_MAX_PAST_DAYS} dni, więc nie da się ich dobrać"))

    series = trim_to_last_complete(base)
    interpolated, missing_rain = repair_interior_gaps(series)
    return WeatherResult(series, provider, attempts, filled, interpolated, missing_rain)
