"""Ocena sytuacji wodnej (app.core.water_assessment): progi na pełnej precyzji, bez zaokrągleń prezentacyjnych."""
import numpy as np
import pytest

from app.core.water_assessment import assess


def balance(dr_last: float, raw_last: float, taw: float = 80.0, etc: float = 4.0, days: int = 10):
    from app.core.water_balance import BalanceResult
    ones = np.ones(days)
    return BalanceResult(depletion_mm=ones * dr_last, raw_mm=ones * raw_last, ks=ones, etc_mm=ones * etc,
                         eta_mm=ones * etc, deep_percolation_mm=np.zeros(days), taw_mm=taw)


def test_just_below_raw_is_not_stress_even_if_both_round_to_same_number():
    a = assess(balance(39.6, 40.4))  # oba zaokrąglone do 40 mm
    assert not a.stressed
    assert a.class_key == "watch"
    assert a.days_to_stress == 0              # 0,8 mm przy 4 mm/d
    assert a.margin_to_stress_mm == pytest.approx(0.8)


def test_just_above_raw_is_stress_even_if_rounded_values_are_equal():
    a = assess(balance(40.4, 39.6))  # po zaokrągleniu 40 = 40, a mimo to próg przekroczony
    assert a.stressed
    assert a.class_key == "moderate"
    assert a.days_to_stress is None
    assert a.ks < 1.0


def test_days_to_stress_uses_unrounded_margin_and_demand():
    a = assess(balance(20.4, 40.0, etc=2.04))   # 19,6 / 2,04 = 9,6 → 9 dni (z zaokrąglonych 20 / 2 byłoby 10)
    assert a.days_to_stress == 9


def test_low_demand_gives_no_days_to_stress():
    a = assess(balance(10.0, 40.0, etc=0.2))
    assert a.days_to_stress is None


def test_zero_taw_is_severe_without_division_error():
    a = assess(balance(0.0, 0.0, taw=0.0))
    assert a.class_key == "severe" and a.depletion_pct_taw == 100.0 and a.available_mm == 0.0
