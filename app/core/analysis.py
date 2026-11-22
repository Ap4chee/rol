"""Porównania z ostatnimi 10 latami: okna pogodowe, klimatyczny bilans wodny, stres w sezonach.

Wszystkie funkcje działają na ciągu kolejnych dni kończącym się w ostatnim dniu z danymi,
który nigdy nie jest późniejszy niż data analizy. Porównania sięgają wyłącznie wstecz.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timedelta

import numpy as np

from app.core.crops import Crop, CropDaily, Season, season_for_harvest_year, sowing_after
from app.core.water_balance import BalanceResult

# Mediana z mniej niż 5 lat za bardzo zależy od pojedynczego roku, więc wtedy nie porównujemy.
MIN_YEARS_FOR_MEDIAN = 5
# Pierwszy rok serii to rozbieg bilansu (zapas startuje od pełnego), do porównań się nie nadaje.
WARMUP_INDEX = 365


@dataclass(frozen=True)
class WindowStats:
    """Opad i ET0 z okna `days` dni do dnia analizy oraz mediany z tych samych okresów w poprzednich latach."""
    days: int
    rain_mm: float
    et0_mm: float
    years_compared: int
    rain_median_mm: float | None = None
    et0_median_mm: float | None = None
    rain_pct_of_median: float | None = None
    et0_pct_of_median: float | None = None


@dataclass(frozen=True)
class ClimaticBalance:
    days: int
    date_from: date
    date_to: date
    rain_mm: float
    et0_mm: float
    balance_mm: float
    median_10y_mm: float | None
    years_compared: int
    drier_years: int | None   # w ilu z porównywanych lat ten sam okres był suchszy


@dataclass(frozen=True)
class SeasonStress:
    season: str
    critical_from: date
    critical_to: date
    stress_days_critical: int
    severe_days_critical: int
    longest_stress_run_days: int
    max_depletion_pct_taw: float
    stressed: bool
    complete: bool


@dataclass(frozen=True)
class IrrigationNeed:
    """Pola so_far_* są tylko, gdy uprawa jest teraz w polu; typical_* tylko przy co najmniej 5 pełnych sezonach."""
    current_label: int | None
    seasons: int
    season_from: date | None = None
    so_far_mm: float | None = None
    so_far_events: int | None = None
    etc_so_far_mm: float | None = None
    rain_so_far_mm: float | None = None
    typical_mm: float | None = None
    dry_mm: float | None = None
    seasons_without: int = 0
    dose_mm: float | None = None
    monthly: list[tuple[int, float]] = field(default_factory=list)


@dataclass(frozen=True)
class SameDayComparison:
    current_pct: float
    median_pct: float
    years: int
    drier_years: int


@dataclass(frozen=True)
class BarePeriod:
    date_from: date
    date_to: date
    rain_mm: float
    evaporation_mm: float


@dataclass(frozen=True)
class SeasonSummary:
    season: str
    date_from: date
    date_to: date
    rain_mm: float
    etc_mm: float
    stress_days: int
    stress_days_critical: int
    longest_stress_run_days: int
    max_depletion_pct_taw: float


def same_day_years_back(day: date, years_back: int) -> date:
    """Ten sam dzień kalendarzowy `years_back` lat wcześniej (29 lutego → 28 lutego)."""
    try:
        return day.replace(year=day.year - years_back)
    except ValueError:
        return day.replace(year=day.year - years_back, day=28)


def index_of(dates: list[date], day: date) -> int | None:
    i = (day - dates[0]).days
    return i if 0 <= i < len(dates) else None


def window_sum(values: np.ndarray, end_index: int, days: int) -> float | None:
    start = end_index - days + 1
    if start < 0:
        return None
    return float(values[start:end_index + 1].sum())


def historical_window_sums(dates: list[date], values: np.ndarray, days: int, years: int) -> list[float]:
    """Sumy z okna `days` dni kończącego się w tym samym dniu roku w każdym z `years` poprzednich lat."""
    out: list[float] = []
    for k in range(1, years + 1):
        i = index_of(dates, same_day_years_back(dates[-1], k))
        if i is None:
            continue
        s = window_sum(values, i, days)
        if s is not None:
            out.append(s)
    return out


def weather_windows(dates: list[date], rain_mm: np.ndarray, et0_mm: np.ndarray,
                    windows: tuple[int, ...] = (30, 60, 90), years: int = 10) -> list[WindowStats]:
    """Opad i ET0 z ostatnich 30/60/90 dni względem mediany z tego samego okresu w poprzednich latach."""
    last = len(dates) - 1
    out = []
    for days in windows:
        rain = window_sum(rain_mm, last, days)
        et0 = window_sum(et0_mm, last, days)
        if rain is None or et0 is None:
            continue
        rain_hist = historical_window_sums(dates, rain_mm, days, years)
        et0_hist = historical_window_sums(dates, et0_mm, days, years)
        if len(rain_hist) < MIN_YEARS_FOR_MEDIAN:
            out.append(WindowStats(days, rain, et0, len(rain_hist)))
            continue
        rain_median = float(np.median(rain_hist))
        et0_median = float(np.median(et0_hist))
        out.append(WindowStats(
            days, rain, et0, len(rain_hist), rain_median_mm=rain_median, et0_median_mm=et0_median,
            rain_pct_of_median=100.0 * rain / rain_median if rain_median > 0 else None,
            et0_pct_of_median=100.0 * et0 / et0_median if et0_median > 0 else None))
    return out


def climatic_water_balance(dates: list[date], rain_mm: np.ndarray, et0_mm: np.ndarray,
                           days: int = 60, years: int = 10) -> ClimaticBalance | None:
    """Klimatyczny bilans wodny (opad − ET0) z ostatnich `days` dni i jego miejsce na tle poprzednich lat."""
    last = len(dates) - 1
    rain = window_sum(rain_mm, last, days)
    et0 = window_sum(et0_mm, last, days)
    if rain is None or et0 is None:
        return None
    balance = rain - et0
    hist = historical_window_sums(dates, rain_mm - et0_mm, days, years)
    return ClimaticBalance(
        days=days, date_from=dates[last - days + 1], date_to=dates[last],
        rain_mm=rain, et0_mm=et0, balance_mm=balance,
        median_10y_mm=float(np.median(hist)) if len(hist) >= MIN_YEARS_FOR_MEDIAN else None,
        years_compared=len(hist),
        drier_years=int(sum(1 for h in hist if h < balance)) if hist else None)


def longest_run(flags: np.ndarray) -> int:
    best = run = 0
    for f in flags:
        run = run + 1 if f else 0
        best = max(best, run)
    return best


def season_stress(dates: list[date], season: Season, crop_daily: CropDaily,
                  balance: BalanceResult) -> SeasonStress | None:
    """Stres wodny w okresie krytycznym jednego sezonu. None, gdy seria nie obejmuje żadnego dnia okresu."""
    n = len(dates)
    c_lo = max((season.critical_start - dates[0]).days, 0)
    c_hi = min((season.critical_end - dates[0]).days, n)
    if c_hi <= c_lo or (season.critical_start - dates[0]).days < 0:
        return None
    stressed = balance.depletion_mm[c_lo:c_hi] > balance.raw_mm[c_lo:c_hi] + 1e-9
    # silny niedobór: wyczerpana ponad połowa wody trudno dostępnej (klasa „severe” z water_balance.classify)
    severe = balance.depletion_mm[c_lo:c_hi] > balance.raw_mm[c_lo:c_hi] + 0.5 * (balance.taw_mm - balance.raw_mm[c_lo:c_hi])
    s_lo = max((season.sowing - dates[0]).days, 0)
    s_hi = min((season.harvest - dates[0]).days, n)
    in_season = slice(max(s_lo, c_lo - 60), s_hi)
    max_pct = float((balance.depletion_mm[in_season] / balance.taw_mm).max() * 100.0) if balance.taw_mm > 0 else 0.0
    complete = (season.critical_end - dates[0]).days <= n
    return SeasonStress(
        season=str(season.label),
        critical_from=season.critical_start,
        critical_to=season.critical_end - timedelta(days=1),
        stress_days_critical=int(stressed.sum()),
        severe_days_critical=int(severe.sum()),
        longest_stress_run_days=longest_run(stressed),
        max_depletion_pct_taw=max_pct,
        stressed=bool(stressed.any()),
        complete=complete)


def seasons_history(dates: list[date], crop: Crop, crop_daily: CropDaily, balance: BalanceResult,
                    years: int = 10) -> list[SeasonStress]:
    """Stres w okresie krytycznym dla sezonu bieżącego (jeśli już trwa) i do `years` poprzednich."""
    last = dates[-1]
    current_label = last.year
    while season_for_harvest_year(crop, current_label).critical_start > last:
        current_label -= 1
    out = []
    for label in range(current_label - years, current_label + 1):
        row = season_stress(dates, season_for_harvest_year(crop, label), crop_daily, balance)
        if row is not None:
            out.append(row)
    return out


def typical_band(dates: list[date], available_pct: np.ndarray, start: int, years: int = 10,
                 min_years: int = MIN_YEARS_FOR_MEDIAN) -> list[tuple[float, float, float] | None]:
    """Dla dni od `start` do końca serii: percentyle 10, 50 i 90 zapasu wody [%] w tym samym dniu roku
    w `years` poprzednich latach. Pierwszy rok serii (rozbieg bilansu) nie wchodzi. None przy mniej niż `min_years` latach."""
    return typical_for(dates, available_pct, dates[start:], years, min_years)


def typical_for(dates: list[date], available_pct: np.ndarray, targets: list[date], years: int = 10,
                min_years: int = MIN_YEARS_FOR_MEDIAN) -> list[tuple[float, float, float] | None]:
    """Jak typical_band, ale dla dowolnych dni, także spoza serii (dni prognozy): te same dni w poprzednich latach serii."""
    out: list[tuple[float, float, float] | None] = []
    for target in targets:
        hist = []
        for k in range(1, years + 1):
            j = index_of(dates, same_day_years_back(target, k))
            if j is not None and j >= WARMUP_INDEX:
                hist.append(float(available_pct[j]))
        if len(hist) < min_years:
            out.append(None)
        else:
            p10, p50, p90 = np.percentile(hist, [10, 50, 90])
            out.append((float(p10), float(p50), float(p90)))
    return out


def _past_irrigation_seasons(dates: list[date], labels: np.ndarray, irr: np.ndarray, current: int | None,
                             years: int) -> list[dict]:
    past = []
    for label in sorted({int(x) for x in labels if x}):
        idx = np.nonzero(labels == label)[0]
        if label == current or idx[0] < WARMUP_INDEX or idx[-1] >= len(dates) - 1:
            continue                      # sezon bieżący, w rozbiegu albo niedomknięty w serii
        events = irr[idx][irr[idx] > 0]
        months: dict[int, float] = {}
        for i in idx:
            months[dates[i].month] = months.get(dates[i].month, 0.0) + float(irr[i])
        past.append({"label": label, "total": float(irr[idx].sum()), "events": events, "months": months})
    return past[-years:]


def irrigation_need(dates: list[date], crop: Crop, crop_daily: CropDaily, irrigated: BalanceResult,
                    rain_mm: np.ndarray, years: int = 10) -> IrrigationNeed | None:
    """Zapotrzebowanie na nawadnianie (bilans z dawkami przy przekroczeniu RAW): bieżący sezon do ostatniego dnia
    serii oraz pełne sezony z `years` poprzednich lat (mediana, 90. percentyl, rozkład na miesiące).
    Sezon wlicza się tylko, gdy cały mieści się w serii po roku rozbiegu bilansu."""
    irr, labels = irrigated.irrigation_mm, crop_daily.season_label
    if irr is None:
        return None
    current = int(labels[-1]) if labels[-1] and crop_daily.in_field[-1] else None
    past = _past_irrigation_seasons(dates, labels, irr, current, years)
    out: dict = {"current_label": current, "seasons": len(past)}
    if current is not None:
        idx = np.nonzero(labels == current)[0]
        out.update(so_far_mm=float(irr[idx].sum()), so_far_events=int((irr[idx] > 0).sum()),
                   etc_so_far_mm=float(irrigated.etc_mm[idx].sum()), rain_so_far_mm=float(rain_mm[idx].sum()),
                   season_from=dates[idx[0]])
    if len(past) >= MIN_YEARS_FOR_MEDIAN:
        totals = [p["total"] for p in past]
        doses = np.concatenate([p["events"] for p in past]) if any(len(p["events"]) for p in past) else np.array([])
        first_month = dates[np.nonzero(labels == past[-1]["label"])[0][0]].month
        order = sorted({m for p in past for m in p["months"]}, key=lambda m: (m - first_month) % 12)
        out.update(typical_mm=float(np.median(totals)), dry_mm=float(np.percentile(totals, 90)),
                   seasons_without=int(sum(1 for t in totals if t < 1)),
                   dose_mm=float(np.median(doses)) if len(doses) else None,
                   monthly=[(m, float(np.mean([p["months"].get(m, 0.0) for p in past]))) for m in order])
    return IrrigationNeed(**out)


def same_day_comparison(dates: list[date], depletion_pct: np.ndarray, years: int = 10) -> SameDayComparison | None:
    """Wyczerpanie w dniu analizy na tle tego samego dnia roku w poprzednich latach."""
    current = float(depletion_pct[-1])
    hist = []
    for k in range(1, years + 1):
        i = index_of(dates, same_day_years_back(dates[-1], k))
        if i is not None and i >= WARMUP_INDEX:
            hist.append(float(depletion_pct[i]))
    if len(hist) < MIN_YEARS_FOR_MEDIAN:
        return None
    return SameDayComparison(current_pct=current, median_pct=float(np.median(hist)), years=len(hist),
                             drier_years=int(sum(1 for h in hist if h > current)))


def bare_period_stats(dates: list[date], crop: Crop, balance: BalanceResult, rain_mm: np.ndarray,
                      min_days: int = 14) -> BarePeriod | None:
    """Opad i parowanie z odkrytej gleby w ostatnim okresie bez uprawy (między zbiorem a kolejnym siewem).

    Bierze najnowszy taki okres, z którego seria ma co najmniej `min_days` dni. None dla upraw trwałych.
    """
    if crop.perennial:
        return None
    last = dates[-1]
    for label in range(last.year + 1, last.year - 3, -1):
        previous = season_for_harvest_year(crop, label - 1)
        start = previous.harvest
        # Zliczamy wyłącznie dni bez uprawy w bilansie, najwyżej do podanego kolejnego siewu.
        next_sowing = min(season_for_harvest_year(crop, label).sowing, sowing_after(crop, previous))
        end = min(next_sowing - timedelta(days=1), last)
        lo, hi = (start - dates[0]).days, (end - dates[0]).days + 1
        if lo < 0 or hi - lo < min_days:
            continue
        return BarePeriod(date_from=start, date_to=end, rain_mm=float(rain_mm[lo:hi].sum()),
                          evaporation_mm=float(balance.eta_mm[lo:hi].sum()))
    return None


def season_summary(dates: list[date], season: Season, crop_daily: CropDaily, balance: BalanceResult,
                   rain_mm: np.ndarray) -> SeasonSummary | None:
    """Podsumowanie zakończonego sezonu: opad, zużycie wody, dni stresu."""
    n = len(dates)
    lo = (season.sowing - dates[0]).days
    hi = (season.harvest - dates[0]).days
    if lo < 0 or hi > n or hi <= lo:
        return None
    stressed = balance.depletion_mm[lo:hi] > balance.raw_mm[lo:hi] + 1e-9
    # stres liczymy od ruszenia wegetacji: zimą zapotrzebowanie jest znikome
    active_lo = max((season.development_start - dates[0]).days, lo)
    stressed_active = balance.depletion_mm[active_lo:hi] > balance.raw_mm[active_lo:hi] + 1e-9
    c_lo = max((season.critical_start - dates[0]).days, 0)
    c_hi = min((season.critical_end - dates[0]).days, n)
    critical = balance.depletion_mm[c_lo:c_hi] > balance.raw_mm[c_lo:c_hi] + 1e-9
    return SeasonSummary(
        season=str(season.label),
        date_from=season.sowing,
        date_to=season.harvest - timedelta(days=1),
        rain_mm=float(rain_mm[lo:hi].sum()),
        etc_mm=float(balance.eta_mm[lo:hi].sum()),
        stress_days=int(stressed_active.sum()),
        stress_days_critical=int(critical.sum()),
        longest_stress_run_days=longest_run(stressed),
        max_depletion_pct_taw=float((balance.depletion_mm[lo:hi] / balance.taw_mm).max() * 100.0)
        if balance.taw_mm > 0 else 0.0)
