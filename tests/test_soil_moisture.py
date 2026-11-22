"""Wilgotność warstw z NASA POWER na tle poprzednich lat. Bez sieci."""
from datetime import date, timedelta

from app.core.soil_moisture import agreement_with_balance, compare_layers
from app.sources.soil_moisture import parse


def series(end: date, years: int, value_for_year) -> dict[date, float]:
    out = {}
    for back in range(years + 1):
        year_end = end.replace(year=end.year - back)
        for i in range(10):
            out[year_end - timedelta(days=i)] = value_for_year(year_end.year)
    return out


def test_dry_root_zone_is_ranked_against_previous_years_only():
    end = date(2025, 7, 15)
    root = series(end, 10, lambda y: 0.2 if y == 2025 else 0.3 + (y - 2015) * 0.01)
    root[date(2025, 7, 20)] = 0.9   # dzień po dacie analizy nie może wejść do wyniku
    layers = compare_layers({"GWETROOT": root}, end, 10)
    assert [layer.key for layer in layers] == ["root_zone"]
    layer = layers[0]
    assert layer.current_to == end
    assert round(layer.comparison.current, 3) == 0.2
    assert layer.comparison.years_compared == 10
    assert layer.comparison.years_higher == 10
    assert layer.comparison.class_key == "very_low"
    assert "zgadzają się" in agreement_with_balance(layers, "severe")


def test_missing_recent_days_shift_the_window_and_short_history_is_skipped():
    end = date(2025, 7, 15)
    top = series(date(2025, 7, 12), 10, lambda y: 0.3)          # ostatnie 3 dni bez danych, jak w NASA POWER
    prof = series(end, 3, lambda y: 0.3)                        # za mało lat do porównania
    layers = compare_layers({"GWETTOP": top, "GWETPROF": prof}, end, 10)
    assert [layer.key for layer in layers] == ["surface"]
    assert layers[0].current_to == date(2025, 7, 12)
    assert layers[0].comparison.class_key == "high"             # nigdy nie było wyżej (remisy nie liczą się jako wyżej)


def test_parse_drops_fill_values():
    payload = {"header": {"fill_value": -999.0},
               "properties": {"parameter": {"GWETROOT": {"20250701": 0.39, "20250702": -999.0}}}}
    assert parse(payload) == {"GWETROOT": {date(2025, 7, 1): 0.39}}


def test_typical_band_uses_only_previous_years_and_skips_warmup():
    import numpy as np

    from app.core.analysis import typical_band
    start_day = date(2014, 1, 1)
    dates = [start_day + timedelta(days=i) for i in range((date(2025, 7, 15) - start_day).days + 1)]
    values = np.array([float(d.year) for d in dates])        # zapas = rok, łatwo sprawdzić, które lata weszły
    band = typical_band(dates, values, len(dates) - 1, years=10)
    p10, p50, p90 = band[0]
    assert p90 < 2025                                          # bieżący rok nie wchodzi
    assert round(p50, 1) == 2019.5                             # lata 2015–2024
    assert typical_band(dates[:400], values[:400], 399, years=10) == [None]   # za mało lat


def test_typical_for_forecast_days_after_series_end():
    import numpy as np

    from app.core.analysis import typical_for
    start_day = date(2014, 1, 1)
    dates = [start_day + timedelta(days=i) for i in range((date(2025, 7, 15) - start_day).days + 1)]
    values = np.array([float(d.year) for d in dates])
    (p10, p50, p90), = typical_for(dates, values, [date(2025, 7, 20)], years=10)   # dzień prognozy, poza serią
    assert round(p50, 1) == 2019.5 and p90 < 2025                                  # lata 2015–2024, jak dla historii
