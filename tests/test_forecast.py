from datetime import date, timedelta

import pytest

from app.schemas import Status
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
    }}, today)
    assert result.status is Status.ok
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
