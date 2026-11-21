"""Ewapotranspiracja wskaźnikowa ET0 wzorem FAO-56 Penmana-Monteitha, krok dzienny.

Źródło: Allen i in. (1998), FAO Irrigation and Drainage Paper 56, rozdz. 3–4
(https://www.fao.org/4/x0490e/x0490e08.htm). Numery równań w komentarzach odnoszą się do FAO-56.
Funkcje są czyste i działają na liczbach albo tablicach numpy.
Test: przykład 18 FAO-56 (Uccle, 6 lipca) daje 3,88 mm/dobę.
"""
from __future__ import annotations

import numpy as np

SOLAR_CONSTANT_MJ_M2_MIN = 0.0820
STEFAN_BOLTZMANN_MJ_K4_M2_DAY = 4.903e-9
ALBEDO_GRASS = 0.23


def saturation_vapour_pressure_kpa(temp_c):
    """e°(T) [kPa], równanie 11."""
    temp_c = np.asarray(temp_c, dtype=float)
    return 0.6108 * np.exp(17.27 * temp_c / (temp_c + 237.3))


def actual_vapour_pressure_from_rh_max_min_kpa(tmax_c, tmin_c, rh_max_pct, rh_min_pct):
    """ea [kPa] z wilgotności maksymalnej i minimalnej, równanie 17."""
    return (saturation_vapour_pressure_kpa(tmin_c) * np.asarray(rh_max_pct, dtype=float) / 100.0
            + saturation_vapour_pressure_kpa(tmax_c) * np.asarray(rh_min_pct, dtype=float) / 100.0) / 2.0


def actual_vapour_pressure_from_rh_mean_kpa(tmax_c, tmin_c, rh_mean_pct):
    """ea [kPa] ze średniej dobowej wilgotności względnej, równanie 19."""
    es = (saturation_vapour_pressure_kpa(tmax_c) + saturation_vapour_pressure_kpa(tmin_c)) / 2.0
    return np.asarray(rh_mean_pct, dtype=float) / 100.0 * es


def extraterrestrial_radiation_mj_m2_day(lat_deg: float, day_of_year):
    """Ra [MJ m-2 doba-1], równania 21–25."""
    j = np.asarray(day_of_year, dtype=float)
    phi = np.radians(lat_deg)
    dr = 1.0 + 0.033 * np.cos(2.0 * np.pi / 365.0 * j)            # (23)
    delta = 0.409 * np.sin(2.0 * np.pi / 365.0 * j - 1.39)        # (24)
    ws = np.arccos(np.clip(-np.tan(phi) * np.tan(delta), -1.0, 1.0))  # (25)
    return (24.0 * 60.0 / np.pi) * SOLAR_CONSTANT_MJ_M2_MIN * dr * (
        ws * np.sin(phi) * np.sin(delta) + np.cos(phi) * np.cos(delta) * np.sin(ws))  # (21)


def et0_fao56_mm_day(tmax_c, tmin_c, rs_mj_m2_day, u2_m_s, ea_kpa, lat_deg: float, elevation_m: float, day_of_year):
    """ET0 [mm/dobę], równanie 6 FAO-56.

    tmax_c, tmin_c  – temperatura powietrza na 2 m [°C]
    rs_mj_m2_day    – promieniowanie słoneczne przy powierzchni [MJ m-2 doba-1]
    u2_m_s          – prędkość wiatru na 2 m [m/s]
    ea_kpa          – aktualne ciśnienie pary wodnej [kPa]
    lat_deg         – szerokość geograficzna [stopnie, północ dodatnia]
    elevation_m     – wysokość n.p.m. [m]
    day_of_year     – numer dnia w roku (1–366)
    """
    tmax_c = np.asarray(tmax_c, dtype=float)
    tmin_c = np.asarray(tmin_c, dtype=float)
    rs = np.asarray(rs_mj_m2_day, dtype=float)
    u2 = np.asarray(u2_m_s, dtype=float)
    ea = np.asarray(ea_kpa, dtype=float)

    tmean = (tmax_c + tmin_c) / 2.0
    pressure_kpa = 101.3 * ((293.0 - 0.0065 * elevation_m) / 293.0) ** 5.26      # (7)
    gamma = 0.000665 * pressure_kpa                                              # (8)
    delta = 4098.0 * saturation_vapour_pressure_kpa(tmean) / (tmean + 237.3) ** 2  # (13)
    es = (saturation_vapour_pressure_kpa(tmax_c) + saturation_vapour_pressure_kpa(tmin_c)) / 2.0  # (12)

    ra = extraterrestrial_radiation_mj_m2_day(lat_deg, day_of_year)
    rso = (0.75 + 2e-5 * elevation_m) * ra                                       # (37)
    rns = (1.0 - ALBEDO_GRASS) * rs                                              # (38)
    with np.errstate(divide="ignore", invalid="ignore"):
        rs_rso = np.where(rso > 0, rs / rso, 1.0)
    rs_rso = np.clip(rs_rso, 0.25, 1.0)  # FAO-56: stosunek Rs/Rso ograniczony do 1,0
    tmax_k4 = (tmax_c + 273.16) ** 4
    tmin_k4 = (tmin_c + 273.16) ** 4
    rnl = (STEFAN_BOLTZMANN_MJ_K4_M2_DAY * (tmax_k4 + tmin_k4) / 2.0
           * (0.34 - 0.14 * np.sqrt(np.maximum(ea, 0.0))) * (1.35 * rs_rso - 0.35))  # (39)
    rn = rns - rnl                                                                # (40), G = 0 dla doby (42)

    numerator = 0.408 * delta * rn + gamma * 900.0 / (tmean + 273.0) * u2 * (es - ea)
    denominator = delta + gamma * (1.0 + 0.34 * u2)
    return np.maximum(numerator / denominator, 0.0)
