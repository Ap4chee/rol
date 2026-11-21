"""ET0 FAO-56 Penmana-Monteitha na przykładzie 18 z FAO-56 (rozdz. 4, dane dzienne, Uccle, 6 lipca).

Dane wejściowe i wyniki pośrednie przepisane z tekstu na https://www.fao.org/4/x0490e/x0490e08.htm
(pobrane 21.11.2026). Testy nie używają sieci.
"""
import numpy as np
import pytest

from app.core.et0 import (
    actual_vapour_pressure_from_rh_max_min_kpa,
    actual_vapour_pressure_from_rh_mean_kpa,
    et0_fao56_mm_day,
    extraterrestrial_radiation_mj_m2_day,
    saturation_vapour_pressure_kpa,
)

# Uccle (Bruksela): 50 st. 48 min N, 100 m n.p.m., 6 lipca (J = 187)
LAT_DEG, ELEVATION_M, DOY = 50.80, 100.0, 187
TMAX_C, TMIN_C = 21.5, 12.3
RH_MAX_PCT, RH_MIN_PCT = 84.0, 63.0
U2_M_S = 2.078           # 10 km/h na 10 m przeliczone w przykładzie na 2 m
RS_MJ_M2_DAY = 22.07     # z 9,25 h usłonecznienia (równanie 35)


def test_saturation_vapour_pressure_matches_example_18():
    assert float(saturation_vapour_pressure_kpa(TMAX_C)) == pytest.approx(2.564, abs=0.002)
    assert float(saturation_vapour_pressure_kpa(TMIN_C)) == pytest.approx(1.431, abs=0.002)


def test_actual_vapour_pressure_matches_example_18():
    ea = actual_vapour_pressure_from_rh_max_min_kpa(TMAX_C, TMIN_C, RH_MAX_PCT, RH_MIN_PCT)
    assert float(ea) == pytest.approx(1.409, abs=0.002)


def test_extraterrestrial_radiation_matches_example_18():
    assert float(extraterrestrial_radiation_mj_m2_day(LAT_DEG, DOY)) == pytest.approx(41.09, abs=0.05)


def test_et0_matches_example_18():
    ea = actual_vapour_pressure_from_rh_max_min_kpa(TMAX_C, TMIN_C, RH_MAX_PCT, RH_MIN_PCT)
    et0 = et0_fao56_mm_day(TMAX_C, TMIN_C, RS_MJ_M2_DAY, U2_M_S, ea, LAT_DEG, ELEVATION_M, DOY)
    assert float(et0) == pytest.approx(3.88, abs=0.03)  # FAO-56: 3,88, zaokrąglone do 3,9 mm/dobę


def test_rh_mean_variant_is_close_to_max_min_variant():
    # równanie 19 (średnia wilgotność) daje wynik zbliżony do równania 17, ale nie identyczny
    ea = actual_vapour_pressure_from_rh_mean_kpa(TMAX_C, TMIN_C, (RH_MAX_PCT + RH_MIN_PCT) / 2)
    et0 = et0_fao56_mm_day(TMAX_C, TMIN_C, RS_MJ_M2_DAY, U2_M_S, ea, LAT_DEG, ELEVATION_M, DOY)
    assert float(et0) == pytest.approx(3.88, abs=0.15)


def test_et0_is_never_negative_and_handles_arrays():
    et0 = et0_fao56_mm_day(np.array([-5.0, 21.5]), np.array([-12.0, 12.3]), np.array([0.5, 22.07]),
                           np.array([1.0, 2.078]), np.array([0.25, 1.409]), LAT_DEG, ELEVATION_M, np.array([15, 187]))
    assert et0.shape == (2,)
    assert (et0 >= 0).all()
    assert float(et0[1]) == pytest.approx(3.88, abs=0.03)
