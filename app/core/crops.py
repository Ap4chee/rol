"""Tabela upraw: współczynniki Kc, długości faz, głębokość korzeni i współczynnik p.

Źródło wartości: FAO Irrigation and Drainage Paper 56 (Allen i in. 1998), sprawdzone w tekście
na fao.org 21.11.2026:
- tab. 11 (długości faz rozwojowych), https://www.fao.org/4/x0490e/x0490e0b.htm
- tab. 12 (Kc ini, Kc mid, Kc end), tamże
- tab. 22 (maksymalna efektywna głębokość korzeni Zr i współczynnik p), https://www.fao.org/4/x0490e/x0490e0e.htm

Terminy siewu i fazy upraw ozimych są ZAŁOŻENIAMI dla przeciętnych warunków Polski
(tab. 11 nie ma wierszy dla naszego klimatu). Rolnik nie podaje daty siewu, więc kalendarz jest umowny.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timedelta

import numpy as np

STAGE_NAMES_PL = {
    "initial": "faza początkowa (wschody, mała okrywa)",
    "development": "faza szybkiego wzrostu",
    "mid": "środek sezonu (pełna okrywa, największe zużycie wody)",
    "late": "koniec sezonu (dojrzewanie)",
    "dormant": "spoczynek zimowy",
    "off_season": "poza sezonem (pole po zbiorze albo przed siewem)",
}

# Próg termicznego okresu wegetacyjnego: średnia dobowa temperatura 5 °C (definicja stosowana w Polsce).
GROWTH_TEMP_THRESHOLD_C = 5.0


@dataclass(frozen=True)
class Crop:
    key: str
    name: str
    sowing_month: int
    sowing_day: int
    stage_days: tuple[int, int, int, int]  # początkowa, rozwój, środek, koniec [dni]
    kc_ini: float
    kc_mid: float
    kc_end: float
    root_depth_m: float       # Zr przyjęte do bilansu
    p: float                  # frakcja wyczerpania bez stresu przy ETc = 5 mm/dobę
    winter: bool = False      # siew w roku poprzedzającym zbiór
    perennial: bool = False   # użytek trwały: poza sezonem spoczynek, a nie goła gleba
    kc_ini_frozen: float | None = None            # Kc ini w miesiącach z zamarzniętą glebą (XII–II)
    critical_override: tuple[tuple[int, int], tuple[int, int]] | None = None
    sources: dict[str, str] = field(default_factory=dict)
    assumptions: tuple[str, ...] = ()


CROPS: dict[str, Crop] = {
    "winter_wheat": Crop(
        key="winter_wheat", name="Pszenica ozima", sowing_month=9, sowing_day=25,
        stage_days=(176, 51, 51, 31), winter=True,
        kc_ini=0.7, kc_ini_frozen=0.4, kc_mid=1.15, kc_end=0.25, root_depth_m=1.5, p=0.55,
        sources={
            "kc": "FAO-56, tab. 12: Winter Wheat – Kc ini 0,7 (gleba niezamarznięta) i 0,4 (zamarznięta), "
                  "Kc mid 1,15, Kc end 0,25 (zbiór kombajnem)",
            "root": "FAO-56, tab. 22: Winter Wheat Zr 1,5–1,8 m (przyjęto 1,5), p = 0,55",
            "stages": "założenie dla Polski: siew 25 IX, ruszenie wegetacji 20 III, pełna okrywa 10 V, "
                      "dojrzewanie od 30 VI, zbiór 31 VII (tab. 11 FAO-56 nie ma wiersza dla klimatu Polski)",
        },
        assumptions=("Kc ini 0,4 stosowane w miesiącach XII–II, 0,7 w pozostałych dniach fazy początkowej.",),
    ),
    "spring_barley": Crop(
        key="spring_barley", name="Jęczmień jary", sowing_month=4, sowing_day=1,
        stage_days=(20, 25, 60, 30),
        kc_ini=0.3, kc_mid=1.15, kc_end=0.25, root_depth_m=1.0, p=0.55,
        sources={
            "kc": "FAO-56, tab. 12: Cereals Kc ini 0,3; Barley Kc mid 1,15, Kc end 0,25",
            "root": "FAO-56, tab. 22: Barley Zr 1,0–1,5 m (przyjęto 1,0), p = 0,55",
            "stages": "FAO-56, tab. 11: Barley/Oats/Wheat, siew III/IV, 35–45° szer.: 20/25/60/30 dni; "
                      "założenie dla Polski: siew 1 IV",
        },
    ),
    "winter_rapeseed": Crop(
        key="winter_rapeseed", name="Rzepak ozimy", sowing_month=8, sowing_day=25,
        stage_days=(197, 46, 51, 30), winter=True,
        kc_ini=0.35, kc_mid=1.10, kc_end=0.35, root_depth_m=1.2, p=0.60,
        sources={
            "kc": "FAO-56, tab. 12: Oil Crops Kc ini 0,35; Rapeseed, Canola Kc mid 1,0–1,15 (przyjęto 1,10), Kc end 0,35",
            "root": "FAO-56, tab. 22: Rapeseed, Canola Zr 1,0–1,5 m (przyjęto 1,2), p = 0,60",
            "stages": "założenie dla Polski: siew 25 VIII, ruszenie wegetacji 10 III, kwitnienie od 25 IV, "
                      "dojrzewanie od 15 VI, zbiór 15 VII (tab. 11 FAO-56 nie zawiera rzepaku)",
        },
        assumptions=("Jesienna rozeta rzepaku zużywa więcej wody, niż wynika z Kc ini 0,35; bilans jesienią jest zaniżony.",),
    ),
    "maize": Crop(
        key="maize", name="Kukurydza", sowing_month=4, sowing_day=25,
        stage_days=(30, 40, 50, 50),
        kc_ini=0.3, kc_mid=1.20, kc_end=0.60, root_depth_m=1.2, p=0.55,
        sources={
            "kc": "FAO-56, tab. 12: Cereals Kc ini 0,3; Maize, Field (grain) Kc mid 1,20, "
                  "Kc end 0,60 (zbiór przy dużej wilgotności ziarna)",
            "root": "FAO-56, tab. 22: Maize, Field (grain) Zr 1,0–1,7 m (przyjęto 1,2), p = 0,55",
            "stages": "FAO-56, tab. 11: Maize (grain), siew w kwietniu, Idaho: 30/40/50/50 dni; "
                      "założenie dla Polski: siew 25 IV",
        },
    ),
    "potato": Crop(
        key="potato", name="Ziemniak", sowing_month=4, sowing_day=20,
        stage_days=(30, 35, 50, 30),
        kc_ini=0.5, kc_mid=1.15, kc_end=0.75, root_depth_m=0.5, p=0.35,
        sources={
            "kc": "FAO-56, tab. 12: Roots and Tubers Kc ini 0,5; Potato Kc mid 1,15, Kc end 0,75",
            "root": "FAO-56, tab. 22: Potato Zr 0,4–0,6 m (przyjęto 0,5), p = 0,35",
            "stages": "FAO-56, tab. 11: Potato, sadzenie w kwietniu, Europa: 30/35/50/30 dni; "
                      "założenie dla Polski: sadzenie 20 IV",
        },
    ),
    "sugar_beet": Crop(
        key="sugar_beet", name="Burak cukrowy", sowing_month=4, sowing_day=5,
        stage_days=(50, 40, 50, 40),
        kc_ini=0.35, kc_mid=1.20, kc_end=0.70, root_depth_m=1.0, p=0.55,
        sources={
            "kc": "FAO-56, tab. 12: Sugar Beet Kc ini 0,35, Kc mid 1,20, Kc end 0,70",
            "root": "FAO-56, tab. 22: Sugar Beet Zr 0,7–1,2 m (przyjęto 1,0), p = 0,55",
            "stages": "FAO-56, tab. 11: Sugarbeet, siew w kwietniu, Idaho: 50/40/50/40 dni; "
                      "założenie dla Polski: siew 5 IV",
        },
    ),
    "grassland": Crop(
        key="grassland", name="Użytki zielone", sowing_month=4, sowing_day=1,
        stage_days=(10, 20, 184, 0), perennial=True,
        kc_ini=0.40, kc_mid=0.95, kc_end=0.85, root_depth_m=0.7, p=0.60,
        critical_override=((5, 1), (8, 31)),
        sources={
            "kc": "FAO-56, tab. 12: Grazing Pasture, Rotated Grazing – Kc ini 0,40, Kc mid 0,85–1,05 (przyjęto 0,95), Kc end 0,85",
            "root": "FAO-56, tab. 22: Grazing Pasture Zr 0,5–1,5 m (przyjęto 0,7), p = 0,60",
            "stages": "FAO-56, tab. 11: Grass Pasture 10/20 dni od ruszenia wegetacji; "
                      "założenie dla Polski: sezon 1 IV–31 X, okres krytyczny 1 V–31 VIII",
        },
        assumptions=("Poza sezonem darń jest w spoczynku (Kc 0,40), nie liczymy jej jak gołej gleby.",),
    ),
}


@dataclass(frozen=True)
class Season:
    """Jeden sezon uprawy: granice faz jako daty. Koniec każdego przedziału jest wyłączny."""
    label: int            # rok zbioru
    sowing: date
    development_start: date
    mid_start: date
    late_start: date
    harvest: date         # pierwszy dzień po sezonie
    critical_start: date
    critical_end: date    # wyłącznie


def season_for_harvest_year(crop: Crop, year: int) -> Season:
    sowing = date(year - 1 if crop.winter else year, crop.sowing_month, crop.sowing_day)
    l_ini, l_dev, l_mid, l_late = crop.stage_days
    development_start = sowing + timedelta(days=l_ini)
    mid_start = development_start + timedelta(days=l_dev)
    late_start = mid_start + timedelta(days=l_mid)
    harvest = late_start + timedelta(days=l_late)
    if crop.critical_override:
        (m1, d1), (m2, d2) = crop.critical_override
        critical_start, critical_end = date(year, m1, d1), date(year, m2, d2) + timedelta(days=1)
    else:
        # okres krytyczny: druga połowa fazy szybkiego wzrostu i cały środek sezonu
        critical_start, critical_end = development_start + timedelta(days=l_dev // 2), late_start
    return Season(year, sowing, development_start, mid_start, late_start, harvest, critical_start, critical_end)


def season_containing(crop: Crop, day: date) -> Season | None:
    """Sezon, w którym uprawa jest w polu w danym dniu, albo None."""
    for year in (day.year, day.year + 1):
        season = season_for_harvest_year(crop, year)
        if season.sowing <= day < season.harvest:
            return season
    return None


def last_completed_season(crop: Crop, day: date) -> Season:
    """Ostatni sezon zakończony przed danym dniem (do podsumowania minionego sezonu)."""
    for year in (day.year, day.year - 1):
        season = season_for_harvest_year(crop, year)
        if season.harvest <= day:
            return season
    return season_for_harvest_year(crop, day.year - 2)


def stage_and_kc(crop: Crop, season: Season, day: date) -> tuple[str, float]:
    """Faza i współczynnik Kc w dniu należącym do sezonu (interpolacja liniowa jak w FAO-56, rys. 34)."""
    if day < season.development_start:
        kc = crop.kc_ini
        if crop.kc_ini_frozen is not None and day.month in (12, 1, 2):
            kc = crop.kc_ini_frozen
        return "initial", kc
    if day < season.mid_start:
        span = (season.mid_start - season.development_start).days
        frac = (day - season.development_start).days / span
        return "development", crop.kc_ini + frac * (crop.kc_mid - crop.kc_ini)
    if day < season.late_start:
        return "mid", crop.kc_mid
    span = max((season.harvest - season.late_start).days, 1)
    frac = (day - season.late_start).days / span
    return "late", crop.kc_mid + frac * (crop.kc_end - crop.kc_mid)


ROOT_DEPTH_MIN_M = 0.15   # Zr przy siewie, FAO-56 rozdz. 8 (0,15–0,20 m)


def root_depth_on(crop: Crop, day: date) -> float | None:
    """Głębokość korzeni w danym dniu [m]: liniowo od Zr,min przy siewie do Zr na początku środka sezonu (FAO-56 rozdz. 8).
    None poza sezonem uprawy jednorocznej (brak żywych korzeni). Użytek trwały ma zawsze pełne Zr.
    Tylko do opisu i wizualizacji: bilans liczy stałe Zr."""
    if crop.perennial:
        return crop.root_depth_m
    season = season_containing(crop, day)
    if season is None:
        return None
    frac = (day - season.sowing).days / max((season.mid_start - season.sowing).days, 1)
    return ROOT_DEPTH_MIN_M + (crop.root_depth_m - ROOT_DEPTH_MIN_M) * min(1.0, max(0.0, frac))


@dataclass
class CropDaily:
    """Przebieg dzienny parametrów uprawy dla ciągu kolejnych dni."""
    kc: np.ndarray            # Kc; NaN, gdy pole jest bez uprawy (goła gleba po zbiorze)
    in_field: np.ndarray      # bool: uprawa w polu (dla użytków trwałych zawsze True)
    critical: np.ndarray      # bool: okres krytyczny dla plonu
    season_label: np.ndarray  # rok zbioru sezonu, do którego należy dzień (0 = poza sezonem)
    stage: list[str]


def daily_crop_arrays(crop: Crop, dates: list[date]) -> CropDaily:
    n = len(dates)
    kc = np.full(n, np.nan)
    in_field = np.zeros(n, dtype=bool)
    critical = np.zeros(n, dtype=bool)
    season_label = np.zeros(n, dtype=int)
    stage = ["off_season"] * n
    if n == 0:
        return CropDaily(kc, in_field, critical, season_label, stage)
    first, last = dates[0], dates[-1]
    for year in range(first.year - 1, last.year + 2):
        season = season_for_harvest_year(crop, year)
        lo = max((season.sowing - first).days, 0)
        hi = min((season.harvest - first).days, n)
        for i in range(lo, hi):
            stage[i], kc[i] = stage_and_kc(crop, season, dates[i])
            in_field[i] = True
            season_label[i] = year
        c_lo = max((season.critical_start - first).days, 0)
        c_hi = min((season.critical_end - first).days, n)
        if c_hi > c_lo:
            critical[c_lo:c_hi] = True
    if crop.perennial:
        for i in range(n):
            if not in_field[i]:
                kc[i] = crop.kc_ini
                in_field[i] = True
                stage[i] = "dormant"
                season_label[i] = dates[i].year
    return CropDaily(kc, in_field, critical, season_label, stage)
