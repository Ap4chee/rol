"""Cechy modelu zmiany NDMI. Czyste funkcje bez sieci: te same w treningu i w predykcji (etykieta: pipeline/ndmi/labels.py).

Wszystkie okna cech kończą się na dniu t-1 (dzień prognozy t, doba Europe/Warsaw).
Obserwacja bazowa: najnowsza zaakceptowana scena z t-14 … t-1. Docelowa: pierwsza z t+7 … t+14.

Cechy korzystają tylko z tego, co aplikacja ma dla działki bez dodatkowych zapytań
(app/sources/sentinel.py i app/sources/weather.py):
  - NDMI, NDVI i mediany pasm dla najwyżej trzech czystych scen z 45 dni (bazowa, poprzednia starsza o co najmniej
    7 dni i jeszcze wcześniejsza); trening wybiera sceny tą samą regułą, choć zna wskaźniki wszystkich scen,
  - liczby pikseli klas SCL (roślinność, goła gleba, chmury) wszystkich scen z 45 dni,
  - dzienna pogoda z lat poprzedzających datę (opad, ET0, Tmax, Tmin).
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import date

import numpy as np

from app.core.water_balance import run_water_balance
from kowr_ml.runtime import config as C

# 16 cech pierwszego modelu
BASE_FEATURES = [
    "ndmi_last", "days_since_last_scene", "last_valid_fraction", "ndmi_trend_per_day",
    "day_of_year_sin", "day_of_year_cos",
    "rain_mm_7d", "rain_mm_14d", "rain_mm_30d", "et0_mm_7d", "et0_mm_14d", "et0_mm_30d",
    "cwb_mm_30d", "tmax_c_mean_7d", "ref_depletion_frac", "days_since_rain_5mm",
]
# Sumy temperatur i temperatura: faza rozwoju roślin zależy od ciepła, nie od samej daty
THERMAL_FEATURES = ["gdd5_jan1", "gdd0_jan1", "gdd5_mar1", "gdd5_30d", "tmean_c_7d", "tmean_c_30d", "tmin_c_min_7d"]
# Pogoda wokół zdjęcia bazowego: mokra roślinność zawyża NDMI zdjęcia, od zdjęcia do dnia prognozy pole schnie albo moknie
SCENE_WEATHER_FEATURES = ["rain_mm_scene_2d", "rain_mm_since_scene", "et0_mm_since_scene"]
# Historia zdjęć z 45 dni
HISTORY_FEATURES = ["ndmi_prev", "ndmi_trend2_per_day", "ndmi_accel", "n_clear_45d", "n_scenes_45d",
                    "days_since_any_scene", "veg_frac_latest", "veg_frac_mean_14d"]
# Goła gleba i chmury (klasy SCL): zbiór, uprawa gleby, niepewna maska
SCL_FEATURES = ["bare_frac_last", "bare_frac_latest", "bare_frac_max_45d", "cloud_frac_last", "cloud_frac_mean_45d"]
# Zieloność (dojrzewanie widać w NDVI wcześniej niż w NDMI) i mediany reflektancji zdjęcia bazowego
NDVI_FEATURES = ["ndvi_last", "ndvi_prev", "ndvi_trend_per_day"]
BAND_FEATURES = ["nir_last", "swir_last", "red_last"]
LOCATION_FEATURES = ["lat", "lon"]

# Dłuższe okna opadu i bilansu (60 i 90 dni, od początku roku) sprawdziliśmy i odrzuciliśmy: nie zmieniały błędu.
FEATURES = (BASE_FEATURES + THERMAL_FEATURES + HISTORY_FEATURES + SCENE_WEATHER_FEATURES + SCL_FEATURES
            + NDVI_FEATURES + BAND_FEATURES + LOCATION_FEATURES)
SEASONAL_FEATURES = ["day_of_year_sin", "day_of_year_cos", "ndmi_last"]
NAN = math.nan


def reference_depletion(rain_mm: np.ndarray, et0_mm: np.ndarray) -> np.ndarray:
    """Wyczerpanie referencyjnego wiadra (TAW 100 mm, Kc = 1, p = 0,5) jako frakcja TAW, koniec każdego dnia."""
    n = len(rain_mm)
    res = run_water_balance(rain_mm, et0_mm, kc=np.ones(n), in_field=np.ones(n, dtype=bool),
                            taw_mm=C.REF_TAW_MM, p_table=C.REF_P, tew_mm=1.0, rew_mm=1.0, adjust_p=False)
    return res.depletion_mm / C.REF_TAW_MM


def _cumulative(values: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Suma narastająca z zerem na początku i licznik braków, do szybkich sum z okna."""
    return (np.concatenate([[0.0], np.nancumsum(values)]),
            np.concatenate([[0], np.cumsum(~np.isfinite(values))]))


class WeatherSeries:
    """Dzienna pogoda jednej komórki z indeksem po dacie; zakłada ciąg dni bez przerw."""

    def __init__(self, dates: list[date], rain_mm, et0_mm, tmax_c, tmin_c=None):
        self.start = dates[0]
        self.rain = np.asarray(rain_mm, dtype=float)
        self.et0 = np.asarray(et0_mm, dtype=float)
        self.tmax = np.asarray(tmax_c, dtype=float)
        self.tmin = np.full(len(self.rain), NAN) if tmin_c is None else np.asarray(tmin_c, dtype=float)
        ok = np.isfinite(self.rain) & np.isfinite(self.et0)
        # Bilans liczymy na serii bez braków; dni z brakiem oznaczamy i odrzucamy okna, które je zawierają.
        self.missing = ~ok
        self.depl = reference_depletion(np.where(ok, self.rain, 0.0), np.where(ok, self.et0, 0.0))
        tmean = (self.tmax + self.tmin) / 2.0
        self._rain = _cumulative(self.rain)
        self._et0 = _cumulative(self.et0)
        self._tmean = _cumulative(tmean)
        self._gdd = (_cumulative(np.where(np.isfinite(tmean), np.maximum(tmean - C.GDD_BASE_C, 0.0), NAN))[0], self._tmean[1])
        self._gdd0 = (_cumulative(np.where(np.isfinite(tmean), np.maximum(tmean, 0.0), NAN))[0], self._tmean[1])

    def idx(self, d: date) -> int:
        return (d - self.start).days

    def window(self, arr: np.ndarray, t: date, days: int) -> float | None:
        """Suma z `days` dni kończących się na t-1; None, jeśli okno wychodzi poza serię albo ma braki."""
        end = self.idx(t)  # wyłącznie
        beg = end - days
        if beg < 0 or end > len(arr) or self.missing[beg:end].any():
            return None
        return float(arr[beg:end].sum())

    def _sum(self, series: tuple[np.ndarray, np.ndarray], beg: int, end: int) -> float:
        """Suma z dni [beg, end); NaN, gdy zakres wychodzi poza serię albo zawiera brak."""
        total, gaps = series
        if beg < 0 or end > len(self.rain) or beg >= end or gaps[end] - gaps[beg] > 0:
            return NAN
        return float(total[end] - total[beg])

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

    def extra_features(self, t: date, last_scene: date) -> dict:
        """Cechy pogodowe spoza pierwszego modelu. Brak danych w oknie daje NaN (model drzewiasty go przyjmuje)."""
        i = self.idx(t)
        s, rain, et0 = self._sum, self._rain, self._et0
        out = {}
        out["tmean_c_7d"] = s(self._tmean, i - 7, i) / 7
        out["tmean_c_30d"] = s(self._tmean, i - 30, i) / 30
        week = self.tmin[max(i - 7, 0):i] if 0 < i <= len(self.tmin) else np.array([])
        out["tmin_c_min_7d"] = float(np.nanmin(week)) if i >= 7 and np.isfinite(week).any() else NAN
        jan1, mar1 = self.idx(date(t.year, 1, 1)), self.idx(date(t.year, 3, 1))
        out["gdd5_jan1"] = s(self._gdd, jan1, i)
        out["gdd0_jan1"] = s(self._gdd0, jan1, i)
        out["gdd5_mar1"] = s(self._gdd, mar1, i)
        out["gdd5_30d"] = s(self._gdd, i - 30, i)
        # dzień przed zdjęciem bazowym i dzień zdjęcia, potem dni od zdjęcia do t-1
        scene = self.idx(last_scene)
        out["rain_mm_scene_2d"] = s(rain, scene - 1, scene + 1)
        out["rain_mm_since_scene"] = s(rain, scene + 1, i) if scene + 1 < i else 0.0
        out["et0_mm_since_scene"] = s(et0, scene + 1, i) if scene + 1 < i else 0.0
        return out


def doy_features(t: date) -> dict:
    a = 2 * math.pi * (t.timetuple().tm_yday - 1) / 365.25
    return {"day_of_year_sin": math.sin(a), "day_of_year_cos": math.cos(a)}


@dataclass
class FieldScenes:
    """Sceny jednego pola, rosnąco po dacie, najwyżej jedna na dzień. NaN = wartość nieznana.

    Scena „zaakceptowana” ma policzone NDMI. W aplikacji NDMI mają najwyżej trzy sceny z okna 45 dni,
    w treningu wszystkie czyste; cechy sięgają tylko po sceny, które wybrałaby aplikacja.
    """
    dates: np.ndarray            # datetime64[D]
    total_px: np.ndarray         # środki pikseli 20 m w polu
    veg_px: np.ndarray           # SCL 4
    bare_px: np.ndarray          # SCL 5
    cloud_px: np.ndarray         # SCL 3, 8, 9, 10
    valid_fraction: np.ndarray   # udział pikseli pola użytych do wskaźników
    ndmi: np.ndarray
    ndvi: np.ndarray
    nir: np.ndarray              # mediany reflektancji B8A, B11, B04 po pikselach z roślinnością
    swir: np.ndarray
    red: np.ndarray

    @classmethod
    def from_columns(cls, dates, total_px, veg_px, bare_px, cloud_px, valid_fraction, ndmi, ndvi, nir, swir, red) -> FieldScenes:
        """Porządkuje sceny po dacie i zostawia jedną na dzień: najpierw z NDMI, potem z większym pokryciem."""
        d = np.asarray(dates, dtype="datetime64[D]")
        cols = [np.asarray(c, dtype=float) for c in (total_px, veg_px, bare_px, cloud_px, valid_fraction, ndmi, ndvi, nir, swir, red)]
        keep = cols[0] > 0
        d, cols = d[keep], [c[keep] for c in cols]
        has_ndmi = np.isfinite(cols[5])
        with np.errstate(invalid="ignore"):
            veg_share = cols[1] / cols[0]
        order = np.lexsort((np.nan_to_num(cols[4], nan=-1.0), veg_share, has_ndmi, d))   # ostatni klucz = najważniejszy
        d, cols = d[order], [c[order] for c in cols]
        last_of_day = np.append(d[1:] != d[:-1], True) if len(d) else np.zeros(0, dtype=bool)
        return cls(d[last_of_day], *[c[last_of_day] for c in cols])

    @property
    def accepted(self) -> np.ndarray:
        return np.flatnonzero(np.isfinite(self.ndmi))


def base_scene(s: FieldScenes, t: date) -> int | None:
    """Indeks najnowszej zaakceptowanej sceny z t-14 … t-1 (spec. sekcja 1) albo None."""
    t64 = np.datetime64(t, "D")
    lo, hi = C.LAST_WINDOW_DAYS
    acc = s.accepted
    sel = acc[(s.dates[acc] <= t64 - np.timedelta64(lo, "D")) & (s.dates[acc] >= t64 - np.timedelta64(hi, "D"))]
    return int(sel[-1]) if sel.size else None


def observation_features(s: FieldScenes, t: date) -> dict | None:
    """Cechy ze zdjęć. Zwraca None, gdy w t-14 … t-1 nie ma zaakceptowanej sceny (wtedy brak prognozy)."""
    k = base_scene(s, t)
    if k is None:
        return None
    D = np.timedelta64
    t64 = np.datetime64(t, "D")
    last_d = s.dates[k]
    window_start = t64 - D(C.APP_WINDOW_DAYS, "D")
    acc = s.accepted
    out = {"ndmi_last": float(s.ndmi[k]), "days_since_last_scene": float((t64 - last_d).astype(int)),
           "last_valid_fraction": float(s.valid_fraction[k]), "_last_index": k}
    # poprzednia scena: najnowsza 7–30 dni przed bazową; jeszcze wcześniejsza: co najmniej 7 dni przed poprzednią, w oknie 45 dni
    a, b = C.TREND_WINDOW_DAYS
    prev = acc[(s.dates[acc] <= last_d - D(a, "D")) & (s.dates[acc] >= last_d - D(b, "D"))]
    p = int(prev[-1]) if prev.size else None
    trend = float((s.ndmi[k] - s.ndmi[p]) / (last_d - s.dates[p]).astype(int)) if p is not None else NAN
    out["ndmi_trend_per_day"] = trend
    out["ndmi_prev"] = float(s.ndmi[p]) if p is not None else NAN
    out["ndmi_trend2_per_day"], out["ndmi_accel"] = NAN, NAN
    if p is not None:
        prev2 = acc[(s.dates[acc] <= s.dates[p] - D(C.SCENE_SPACING_DAYS, "D")) & (s.dates[acc] >= window_start)]
        if prev2.size:
            p2 = int(prev2[-1])
            trend2 = float((s.ndmi[p] - s.ndmi[p2]) / (s.dates[p] - s.dates[p2]).astype(int))
            out["ndmi_trend2_per_day"], out["ndmi_accel"] = trend2, trend - trend2
    out["ndvi_last"] = float(s.ndvi[k])
    out["ndvi_prev"] = float(s.ndvi[p]) if p is not None else NAN
    out["ndvi_trend_per_day"] = float((s.ndvi[k] - s.ndvi[p]) / (last_d - s.dates[p]).astype(int)) if p is not None else NAN
    out["nir_last"], out["swir_last"], out["red_last"] = float(s.nir[k]), float(s.swir[k]), float(s.red[k])
    out["bare_frac_last"] = float(s.bare_px[k] / s.total_px[k])
    out["cloud_frac_last"] = float(s.cloud_px[k] / s.total_px[k])
    # klasy SCL wszystkich scen z okna aplikacji (t-45 … t-1)
    w = np.flatnonzero((s.dates >= window_start) & (s.dates < t64))
    total = s.total_px[w]
    veg, bare, cloud = s.veg_px[w] / total, s.bare_px[w] / total, s.cloud_px[w] / total
    clear = (s.veg_px[w] >= C.MIN_PIXELS) & (s.veg_px[w] >= C.MIN_COVERAGE * total) & (total >= C.MIN_PIXELS)
    out["n_scenes_45d"] = float(w.size)
    out["n_clear_45d"] = float(clear.sum())
    out["days_since_any_scene"] = float((t64 - s.dates[w[-1]]).astype(int))
    out["veg_frac_latest"] = float(veg[-1])
    recent = s.dates[w] >= t64 - D(14, "D")
    out["veg_frac_mean_14d"] = float(veg[recent].mean())
    out["bare_frac_latest"] = float(bare[-1])
    out["bare_frac_max_45d"] = float(bare.max())
    out["cloud_frac_mean_45d"] = float(cloud.mean())
    return out


def feature_row(s: FieldScenes, weather: WeatherSeries, t: date, lat: float = NAN, lon: float = NAN) -> dict | None:
    """Pełny wiersz cech dla dnia prognozy t albo None z brakiem danych (obserwacja albo pogoda)."""
    of = observation_features(s, t)
    if of is None:
        return None
    wf = weather.features(t)
    if wf is None:
        return None
    last_scene = s.dates[of["_last_index"]].astype(object)
    return {**of, **wf, **weather.extra_features(t, last_scene), **doy_features(t), "lat": float(lat), "lon": float(lon)}
