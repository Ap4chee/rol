"""Bilans wodny FAO-56: przykład 37 z rozdz. 8 i własności graniczne. Bez sieci.

Przykład 37 (https://www.fao.org/4/x0490e/x0490e0e.htm): pomidor, Zr = 0,8 m, p = 0,40,
θFC = 0,32, θWP = 0,12, początkowe wyczerpanie 55 mm, ET0 = 5 mm/dobę, Kc = 1,2, bez opadu.
Wyczerpanie na koniec dni 1–10: 61,0; 67,0; 72,8; 78,3; 83,4; 88,2; 92,6; 96,9; 100,8; 104,5 mm.
"""
import numpy as np
import pytest

from app.core.water_balance import (
    adjusted_p,
    classify,
    run_water_balance,
    stress_coefficient,
    total_available_water_mm,
    total_evaporable_water_mm,
)


def test_taw_and_raw_match_example_37():
    taw = total_available_water_mm(0.32, 0.12, 0.8)
    assert taw == pytest.approx(160.0)
    assert 0.40 * taw == pytest.approx(64.0)


def test_depletion_series_matches_example_37():
    n = 10
    result = run_water_balance(
        rain_mm=np.zeros(n), et0_mm=np.full(n, 5.0), kc=np.full(n, 1.2), in_field=np.ones(n, dtype=bool),
        taw_mm=160.0, p_table=0.40, tew_mm=20.0, rew_mm=9.0, initial_depletion_mm=55.0, adjust_p=False)
    expected = [61.0, 67.0, 72.8, 78.3, 83.4, 88.2, 92.6, 96.9, 100.8, 104.5]
    assert result.depletion_mm == pytest.approx(expected, abs=0.1)
    assert result.ks[2] == pytest.approx(0.97, abs=0.01)   # dzień 3 w tabeli przykładu
    assert result.ks[9] == pytest.approx(0.62, abs=0.01)   # dzień 10
    assert result.eta_mm[9] == pytest.approx(3.7, abs=0.05)


def test_stress_coefficient_limits():
    assert stress_coefficient(10.0, 100.0, 0.5) == 1.0
    assert stress_coefficient(50.0, 100.0, 0.5) == 1.0
    assert stress_coefficient(75.0, 100.0, 0.5) == pytest.approx(0.5)
    assert stress_coefficient(100.0, 100.0, 0.5) == 0.0


def test_adjusted_p_follows_fao_note_and_limits():
    assert adjusted_p(0.55, 5.0) == pytest.approx(0.55)
    assert adjusted_p(0.55, 2.0) == pytest.approx(0.67)
    assert adjusted_p(0.55, 30.0) == 0.1
    assert adjusted_p(0.75, 0.0) == 0.8


def test_rain_refills_and_surplus_percolates():
    result = run_water_balance(
        rain_mm=np.array([0.0, 0.0, 40.0]), et0_mm=np.full(3, 4.0), kc=np.ones(3), in_field=np.ones(3, dtype=bool),
        taw_mm=100.0, p_table=0.5, tew_mm=20.0, rew_mm=9.0)
    assert result.depletion_mm[1] == pytest.approx(8.0)
    assert result.depletion_mm[2] == 0.0
    assert result.deep_percolation_mm[2] == pytest.approx(40.0 - 8.0 - 4.0)


def test_depletion_never_exceeds_taw_in_long_drought():
    n = 400
    result = run_water_balance(
        rain_mm=np.zeros(n), et0_mm=np.full(n, 6.0), kc=np.full(n, 1.15), in_field=np.ones(n, dtype=bool),
        taw_mm=80.0, p_table=0.55, tew_mm=18.0, rew_mm=8.0)
    assert result.depletion_mm.max() <= 80.0 + 1e-9
    assert result.depletion_mm[-1] == pytest.approx(80.0, abs=0.5)
    assert (np.diff(result.depletion_mm) >= -1e-9).all()


def test_bare_soil_evaporation_is_limited_by_surface_layer():
    # 60 dni bez opadu na gołej glebie: ubywa najwyżej TEW, a nie cały zapas strefy korzeni
    n = 60
    tew = total_evaporable_water_mm(0.28, 0.14)
    result = run_water_balance(
        rain_mm=np.zeros(n), et0_mm=np.full(n, 4.0), kc=np.full(n, np.nan), in_field=np.zeros(n, dtype=bool),
        taw_mm=140.0, p_table=0.55, tew_mm=tew, rew_mm=9.0)
    assert tew == pytest.approx(21.0)
    assert result.depletion_mm[-1] == pytest.approx(tew, abs=0.5)
    assert result.eta_mm[0] == pytest.approx(1.15 * 4.0)   # faza 1: parowanie ograniczone energią
    assert result.eta_mm[-1] < 0.05                         # faza 2: zapas warstwy wyczerpany


def test_water_balance_closes():
    rng = np.random.default_rng(7)
    n = 730
    rain = rng.gamma(0.4, 5.0, n)
    et0 = 2.0 + 1.5 * np.sin(np.arange(n) / 58.0) ** 2
    in_field = (np.arange(n) % 365) < 200
    result = run_water_balance(rain, et0, np.full(n, 0.9), in_field, taw_mm=120.0, p_table=0.55,
                               tew_mm=20.0, rew_mm=9.0)
    # Dr końcowe = Dr początkowe − opad + ETa + przesiąk (z dokładnością do obcięcia na TAW, które tu nie zachodzi)
    closure = -rain.sum() + result.eta_mm.sum() + result.deep_percolation_mm.sum()
    assert result.depletion_mm.max() < 120.0
    assert result.depletion_mm[-1] == pytest.approx(closure, abs=1e-6)


def test_four_classes_relative_to_raw_and_taw():
    assert classify(10.0, raw_mm=50.0, taw_mm=100.0) == "none"
    assert classify(40.0, raw_mm=50.0, taw_mm=100.0) == "watch"
    assert classify(60.0, raw_mm=50.0, taw_mm=100.0) == "moderate"
    assert classify(90.0, raw_mm=50.0, taw_mm=100.0) == "severe"


def test_refill_at_raw_keeps_depletion_below_raw_and_counts_doses():
    import numpy as np
    from app.core.water_balance import run_water_balance
    n = 60
    rain, et0, kc = np.zeros(n), np.full(n, 5.0), np.full(n, 1.0)
    in_field = np.ones(n, dtype=bool)
    r = run_water_balance(rain, et0, kc, in_field, taw_mm=100, p_table=.5, tew_mm=20, rew_mm=8, adjust_p=False, refill_at_raw=True)
    assert (r.depletion_mm <= 50 + 1e-9).all()            # nigdy poniżej progu stresu
    assert (r.irrigation_mm > 0).sum() == 5                 # 55 mm wyczerpania co 11 dni, przez 60 dni
    assert abs(r.irrigation_mm.sum() - (r.etc_mm.sum() - r.depletion_mm[-1])) < 1e-6   # bilans się zamyka
    plain = run_water_balance(rain, et0, kc, in_field, taw_mm=100, p_table=.5, tew_mm=20, rew_mm=8, adjust_p=False)
    assert plain.irrigation_mm is None


def test_fixed_dose_repeats_until_below_raw():
    import numpy as np
    from app.core.water_balance import run_water_balance
    n = 40
    r = run_water_balance(np.zeros(n), np.full(n, 5.0), np.ones(n), np.ones(n, dtype=bool), taw_mm=100, p_table=.5,
                          tew_mm=20, rew_mm=8, adjust_p=False, refill_at_raw=True, dose_mm=25)
    assert set(np.round(r.irrigation_mm[r.irrigation_mm > 0], 6)) == {25.0}
    assert r.depletion_mm.max() <= 55 + 1e-9                # najwyżej jeden dzień ponad RAW, potem dawka
