"""Cechy i etykieta modelu zmiany NDMI. Czyste funkcje bez sieci: te same w treningu i w predykcji.

Wszystkie okna cech kończą się na dniu t-1 (dzień prognozy t, doba Europe/Warsaw).
Obserwacja bazowa: najnowsza zaakceptowana scena z t-14 … t-1. Docelowa: pierwsza z t+7 … t+14.
"""
from __future__ import annotations

import math
from datetime import date, timedelta

import numpy as np

from app.core.water_balance import run_water_balance

from . import config as C

FEATURES = [
    "ndmi_last", "days_since_last_scene", "last_valid_fraction", "ndmi_trend_per_day",
    "day_of_year_sin", "day_of_year_cos",
    "rain_mm_7d", "rain_mm_14d", "rain_mm_30d", "et0_mm_7d", "et0_mm_14d", "et0_mm_30d",
    "cwb_mm_30d", "tmax_c_mean_7d", "ref_depletion_frac", "days_since_rain_5mm",
]
SEASONAL_FEATURES = ["day_of_year_sin", "day_of_year_cos", "ndmi_last"]


def reference_depletion(rain_mm: np.ndarray, et0_mm: np.ndarray) -> np.ndarray:
    """Wyczerpanie referencyjnego wiadra (TAW 100 mm, Kc = 1, p = 0,5) jako frakcja TAW, koniec każdego dnia."""
    n = len(rain_mm)
    res = run_water_balance(rain_mm, et0_mm, kc=np.ones(n), in_field=np.ones(n, dtype=bool),
                            taw_mm=C.REF_TAW_MM, p_table=C.REF_P, tew_mm=1.0, rew_mm=1.0, adjust_p=False)
    return res.depletion_mm / C.REF_TAW_MM


class WeatherSeries:
    """Dzienna pogoda jednej komórki z indeksem po dacie; zakłada ciąg dni bez przerw."""

    def __init__(self, dates: list[date], rain_mm, et0_mm, tmax_c):
        self.start = dates[0]
        self.rain = np.asarray(rain_mm, dtype=float)
        self.et0 = np.asarray(et0_mm, dtype=float)
        self.tmax = np.asarray(tmax_c, dtype=float)
        ok = np.isfinite(self.rain) & np.isfinite(self.et0)
        # Bilans liczymy na serii bez braków; dni z brakiem oznaczamy i odrzucamy okna, które je zawierają.
        self.missing = ~ok
        self.depl = reference_depletion(np.where(ok, self.rain, 0.0), np.where(ok, self.et0, 0.0))

    def idx(self, d: date) -> int:
        return (d - self.start).days

    def window(self, arr: np.ndarray, t: date, days: int) -> float | None:
        """Suma z `days` dni kończących się na t-1; None, jeśli okno wychodzi poza serię albo ma braki."""
        end = self.idx(t)  # wyłącznie
        beg = end - days
        if beg < 0 or end > len(arr) or self.missing[beg:end].any():
            return None
        return float(arr[beg:end].sum())

    def features(self, t: date) -> dict | None:
        out = {}
        for days in (7, 14, 30):
            r = self.window(self.rain, t, days)
            e = self.window(self.et0, t, days)
            if r is None or e is None:
                return None
            out[f"rain_mm_{days}d"] = r
            out[f"et0_mm_{days}d"] = e
        out["cwb_mm_30d"] = out["rain_mm_30d"] - out["et0_mm_30d"]
        i = self.idx(t)
        tm = self.tmax[i - 7:i]
        out["tmax_c_mean_7d"] = float(np.nanmean(tm)) if np.isfinite(tm).sum() >= 5 else math.nan
        # Rozgrzewka bilansu: wymagamy co najmniej 120 dni serii przed t.
        out["ref_depletion_frac"] = float(self.depl[i - 1]) if i - 1 >= 120 else math.nan
        wet = np.flatnonzero(self.rain[max(0, i - 60):i] >= 5.0)
        out["days_since_rain_5mm"] = float(60 - wet[-1]) if wet.size else 61.0
        return out


def doy_features(t: date) -> dict:
    a = 2 * math.pi * (t.timetuple().tm_yday - 1) / 365.25
    return {"day_of_year_sin": math.sin(a), "day_of_year_cos": math.cos(a)}


def observation_features(obs_dates: np.ndarray, obs_ndmi: np.ndarray, obs_frac: np.ndarray, t: date) -> dict | None:
    """Cechy satelitarne z zaakceptowanych obserwacji pola (posortowanych po dacie, typ datetime64[D]).

    Zwraca None, gdy w t-14 … t-1 nie ma zaakceptowanej sceny (spec. sekcja 1: wtedy brak prognozy).
    """
    t64 = np.datetime64(t, "D")
    lo, hi = C.LAST_WINDOW_DAYS
    sel = np.flatnonzero((obs_dates <= t64 - np.timedelta64(lo, "D")) & (obs_dates >= t64 - np.timedelta64(hi, "D")))
    if sel.size == 0:
        return None
    k = sel[-1]
    last_d = obs_dates[k]
    out = {"ndmi_last": float(obs_ndmi[k]), "days_since_last_scene": float((t64 - last_d).astype(int)),
           "last_valid_fraction": float(obs_frac[k]), "_last_index": int(k)}
    a, b = C.TREND_WINDOW_DAYS
    prev = np.flatnonzero((obs_dates <= last_d - np.timedelta64(a, "D")) & (obs_dates >= last_d - np.timedelta64(b, "D")))
    if prev.size:
        p = prev[-1]
        out["ndmi_trend_per_day"] = float((obs_ndmi[k] - obs_ndmi[p]) / (last_d - obs_dates[p]).astype(int))
    else:
        out["ndmi_trend_per_day"] = math.nan
    return out


def target(obs_dates: np.ndarray, obs_ndmi: np.ndarray, obs_frac: np.ndarray, t: date) -> dict | None:
    t64 = np.datetime64(t, "D")
    lo, hi = C.TARGET_WINDOW_DAYS
    sel = np.flatnonzero((obs_dates >= t64 + np.timedelta64(lo, "D")) & (obs_dates <= t64 + np.timedelta64(hi, "D")))
    if sel.size == 0:
        return None
    k = sel[0]
    return {"ndmi_future": float(obs_ndmi[k]), "target_index": int(k), "target_valid_fraction": float(obs_frac[k])}


def feature_row(obs_dates, obs_ndmi, obs_frac, weather: WeatherSeries, t: date) -> dict | None:
    """Pełny wiersz cech dla dnia prognozy t albo None z brakiem danych (obserwacja albo pogoda)."""
    of = observation_features(obs_dates, obs_ndmi, obs_frac, t)
    if of is None:
        return None
    wf = weather.features(t)
    if wf is None:
        return None
    return {**of, **wf, **doy_features(t)}


def issue_dates(season: int) -> list[date]:
    d = date.fromisoformat(f"{season}-{C.ISSUE_FIRST}")
    end = date.fromisoformat(f"{season}-{C.ISSUE_LAST}")
    out = []
    while d <= end:
        out.append(d)
        d += timedelta(days=C.ISSUE_STEP_DAYS)
    return out
