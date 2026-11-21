"""Dzienny bilans wody w strefie korzeni według FAO-56, rozdz. 8 (https://www.fao.org/4/x0490e/x0490e0e.htm).

  TAW = 1000 (θFC − θWP) Zr                    (82)
  RAW = p · TAW                                 (83)
  Ks  = (TAW − Dr) / ((1 − p) TAW) dla Dr > RAW (84)
  Dr,i = Dr,i−1 − P + ETc,adj + DP              (85), 0 ≤ Dr ≤ TAW (86)

Gdy pole jest bez uprawy (po zbiorze, przed siewem), woda ubywa tylko przez parowanie z gleby,
ograniczone zapasem warstwy powierzchniowej (FAO-56, rozdz. 7, równania 73–74: TEW, REW, Kr).

Uproszczenia (wypisywane w raporcie jako ograniczenia): brak spływu powierzchniowego, podsiąku
i śniegu; stała głębokość korzeni przez cały sezon; nieznane nawadnianie; Kc bez poprawki klimatycznej.
Funkcje są czyste: przyjmują tablice i liczby, nie sięgają do sieci.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

# Kc max dla gleby odkrytej: FAO-56 r. 7 podaje 1,2, a przy częstych opadach 1,1; przyjęto wartość pośrednią.
KC_BARE_MAX = 1.15
EVAPORATION_LAYER_M = 0.10  # Ze, FAO-56 tab. 19

CLASS_KEYS = ("none", "watch", "moderate", "severe")
CLASS_LABELS_IN_SEASON = {
    "none": "Brak niedoboru wody",
    "watch": "Zapas łatwo dostępnej wody się kończy",
    "moderate": "Umiarkowany niedobór wody",
    "severe": "Silny niedobór wody",
}
CLASS_LABELS_OFF_SEASON = {
    "none": "Zapas wody w glebie wysoki",
    "watch": "Zapas wody w glebie częściowo wyczerpany",
    "moderate": "Zapas wody w glebie mocno wyczerpany",
    "severe": "Zapas wody w glebie bliski wyczerpania",
}


def total_available_water_mm(field_capacity: float, wilting_point: float, root_depth_m: float) -> float:
    """TAW [mm], równanie 82. Wilgotności w m3/m3."""
    return 1000.0 * max(field_capacity - wilting_point, 0.0) * root_depth_m


def total_evaporable_water_mm(field_capacity: float, wilting_point: float) -> float:
    """TEW [mm] dla warstwy Ze = 0,10 m, równanie 73."""
    return 1000.0 * max(field_capacity - 0.5 * wilting_point, 0.0) * EVAPORATION_LAYER_M


def adjusted_p(p_table: float, etc_mm: float) -> float:
    """Frakcja p skorygowana o dzienne ETc (FAO-56, przypis do tab. 22), ograniczona do 0,1–0,8."""
    return float(min(max(p_table + 0.04 * (5.0 - etc_mm), 0.1), 0.8))


def stress_coefficient(depletion_mm: float, taw_mm: float, p: float) -> float:
    """Ks, równanie 84."""
    if taw_mm <= 0:
        return 0.0
    raw = p * taw_mm
    if depletion_mm <= raw:
        return 1.0
    return float(min(max((taw_mm - depletion_mm) / ((1.0 - p) * taw_mm), 0.0), 1.0))


def classify(depletion_mm: float, raw_mm: float, taw_mm: float) -> str:
    """Cztery klasy słowne wyczerpania wody względem RAW i TAW.

    none     – Dr ≤ 0,5 RAW
    watch    – 0,5 RAW < Dr ≤ RAW (jeszcze bez stresu)
    moderate – Dr > RAW i Ks ≥ 0,5 (wyczerpana mniej niż połowa wody trudno dostępnej)
    severe   – Ks < 0,5
    """
    if taw_mm <= 0:
        return "severe"
    if depletion_mm <= 0.5 * raw_mm:
        return "none"
    if depletion_mm <= raw_mm:
        return "watch"
    if depletion_mm <= raw_mm + 0.5 * (taw_mm - raw_mm):
        return "moderate"
    return "severe"


@dataclass
class BalanceResult:
    depletion_mm: np.ndarray   # Dr na koniec dnia
    raw_mm: np.ndarray         # RAW z p skorygowanym o ETc dnia
    ks: np.ndarray             # współczynnik stresu użyty w danym dniu (1 = brak stresu)
    etc_mm: np.ndarray         # ETc potencjalne (albo potencjalne parowanie z gołej gleby)
    eta_mm: np.ndarray         # ewapotranspiracja rzeczywista
    deep_percolation_mm: np.ndarray
    taw_mm: float


def run_water_balance(
    rain_mm: np.ndarray,
    et0_mm: np.ndarray,
    kc: np.ndarray,
    in_field: np.ndarray,
    taw_mm: float,
    p_table: float,
    tew_mm: float,
    rew_mm: float,
    initial_depletion_mm: float = 0.0,
    adjust_p: bool = True,
) -> BalanceResult:
    """Bilans dzienny dla ciągu kolejnych dni.

    rain_mm, et0_mm – opad i ET0 [mm/dobę], bez braków
    kc              – współczynnik uprawy na każdy dzień (ignorowany, gdy in_field = False)
    in_field        – czy uprawa jest w polu; False = parowanie z gołej gleby
    taw_mm          – woda dostępna ogółem w strefie korzeni
    p_table         – frakcja wyczerpania bez stresu z tab. 22
    tew_mm, rew_mm  – woda możliwa do odparowania z warstwy powierzchniowej (łącznie i w fazie 1)
    adjust_p        – czy korygować p o dzienne ETc (False odtwarza przykład 37 z FAO-56)
    """
    n = len(rain_mm)
    depletion = np.zeros(n)
    raw = np.zeros(n)
    ks_out = np.ones(n)
    etc_out = np.zeros(n)
    eta_out = np.zeros(n)
    dp_out = np.zeros(n)

    tew = max(tew_mm, 1e-6)
    rew = min(max(rew_mm, 0.0), tew)
    dr = min(max(initial_depletion_mm, 0.0), taw_mm)
    de = 0.0  # wyczerpanie warstwy powierzchniowej

    for i in range(n):
        rain = float(rain_mm[i])
        et0 = float(et0_mm[i])
        if in_field[i]:
            etc = float(kc[i]) * et0
            p = adjusted_p(p_table, etc) if adjust_p else p_table
            ks = stress_coefficient(dr, taw_mm, p)
            eta = ks * etc
        else:
            etc = KC_BARE_MAX * et0
            p = p_table
            ks = 1.0
            kr = 1.0 if de <= rew else max((tew - de) / (tew - rew), 0.0) if tew > rew else 0.0  # (74)
            eta = min(kr * etc, max(tew - de, 0.0) + rain)
        de = min(max(de - rain + eta, 0.0), tew)
        dr_new = dr - rain + eta
        if dr_new < 0.0:
            dp_out[i] = -dr_new
            dr_new = 0.0
        dr = min(dr_new, taw_mm)
        depletion[i] = dr
        raw[i] = p * taw_mm
        ks_out[i] = ks
        etc_out[i] = etc
        eta_out[i] = eta
    return BalanceResult(depletion, raw, ks_out, etc_out, eta_out, dp_out, taw_mm)
