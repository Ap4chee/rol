from datetime import date, timedelta

import pytest

from app.sources import NoData
from app.sources.weather import parse_dashboard_forecast


def test_forecast_uses_warsaw_day_boundary_and_preserves_missing_values():
    today = date(2026, 11, 21)
    dates = [today - timedelta(days=2), today - timedelta(days=1), today, today + timedelta(days=2)]
    result = parse_dashboard_forecast({"daily": {
        "time": [day.isoformat() for day in dates],
        "precipitation_sum": [8, None, 0, 12],
        "temperature_2m_max": [15, 17, 18, None],
        "weather_code": [61, None, 0, 80],
        "et0_fao_evapotranspiration": [1, 1.1, 1.5, None],
        "wind_speed_10m_max": [10, 12, 18.5, None],
    }}, today)
    assert [d.date for d in result.recent] == dates[:2]
    assert result.recent[0].et0_mm == 1
    assert result.days[0].wind_max_kmh == 18.5
    assert result.last_wet_day == dates[0]
    assert not result.past_days_complete
    assert len(result.days) == 7
    assert result.days[0].precipitation_mm == 0
    assert result.days[0].weather_code == 0
    assert result.days[1].temperature_max_c is None
    assert result.days[2].precipitation_mm == 12


def test_forecast_with_no_values_does_not_return_fake_weather():
    with pytest.raises(NoData):
        parse_dashboard_forecast({"daily": {"time": ["2026-11-21"], "temperature_2m_max": [None]}},
                                 date(2026, 11, 21))


def test_extended_16_day_forecast_parses_min_and_max_temperatures():
    today = date(2026, 11, 21)
    dates = [today + timedelta(days=i) for i in range(16)]
    result = parse_dashboard_forecast({"daily": {
        "time": [d.isoformat() for d in dates],
        "precipitation_sum": [float(i % 4) for i in range(16)],
        "temperature_2m_max": [10.0 + i * 0.5 for i in range(16)],
        "temperature_2m_min": [2.0 + i * 0.2 for i in range(16)],
        "weather_code": [0] * 16,
        "et0_fao_evapotranspiration": [1.5] * 16,
    }}, today, forecast_days=16)
    assert len(result.days) == 16
    assert result.days[0].temperature_min_c == 2.0
    assert result.days[15].date == today + timedelta(days=15)
    assert result.days[15].temperature_max_c == 17.5
