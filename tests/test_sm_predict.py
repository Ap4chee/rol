"""Prognoza IFS i cechy modelu wilgotności v3 liczone tak jak w treningu (kowr_ml/pipeline/soil_moisture)."""
import math
from datetime import date, datetime, timedelta

from app.sources.ifs_forecast import parse
from app.sources.weather import DailyWeather
from kowr_ml import SoilMoistureForecaster
from kowr_ml.runtime.soil_moisture import ifs_features

T = date(2026, 6, 10)


def payload(hours=24 * 16):
    start = datetime(2026, 6, 9)   # past_days=1
    times = [start + timedelta(hours=h) for h in range(hours)]
    return {"latitude": 52.25, "longitude": 19.25, "hourly": {
        "time": [x.strftime("%Y-%m-%dT%H:%M") for x in times],
        "precipitation": [1.0 if x.hour == 0 else 0.0 for x in times],   # 1 mm w godzinie kończącej się o północy
        "temperature_2m": [float(x.hour) for x in times],
        "soil_moisture_0_to_7cm": [0.10] * hours, "soil_moisture_7_to_28cm": [0.20] * hours,
        "soil_moisture_28_to_100cm": [0.30 if x.hour == 0 else 0.40 for x in times]}}


def test_parse_uses_utc_days_noon_and_layer_weights():
    f = parse(payload(), T)
    assert f.rain_mm == [1.0] * 14                       # godziny 01…24 doby: tylko znacznik 00:00 następnego dnia
    assert f.t2m_c == [12.0] * 14
    assert math.isclose(f.sm_0_100cm[0], (7 * 0.10 + 21 * 0.20 + 72 * 0.40) / 100)
    assert math.isclose(f.sm_analysis, (7 * 0.10 + 21 * 0.20 + 72 * 0.30) / 100)


def test_parse_missing_tail_gives_nan():
    f = parse(payload(hours=24 * 5), T)
    assert f.rain_mm[2] == 1.0 and math.isnan(f.rain_mm[5])


def test_ifs_features_cumulative():
    rows = ifs_features([1, 2, 3, 0, 0, 0, 4], [10, 20, 30, 0, 0, 0, 0], [0.31] * 7, 0.30)
    assert rows[2]["fc_rain_mm_to_k"] == 6 and rows[0]["fc_rain_mm_7d"] == 10
    assert rows[1]["fc_t2m_mean_to_k"] == 15
    assert math.isclose(rows[6]["ifs_sm_change_to_k"], 0.01)


def test_ifs_features_rain_7d_is_first_week_of_longer_horizon():
    rain = [1, 2, 3, 0, 0, 0, 4] + [5] * 7          # 14 dni: suma „7d” liczy tylko t … t+6, jak w treningu
    rows = ifs_features(rain, [0] * 14, [0.31] * 14, 0.30)
    assert len(rows) == 14 and rows[13]["fc_rain_mm_7d"] == 10 and rows[13]["fc_rain_mm_to_k"] == 45


def test_predict_without_model_gives_reason(tmp_path):
    out = SoilMoistureForecaster(tmp_path).predict(None, None, None, T)
    assert out == {"available": False, "reason": "model prognozy wilgotności nie jest zainstalowany"}


def test_predict_with_installed_model_and_old_import_path():
    days = 400
    weather = DailyWeather(dates=[T - timedelta(days=days - i) for i in range(days)], rain_mm=[2.0 if i % 5 == 0 else 0.0 for i in range(days)],
                           et0_mm=[3.0] * days, tmin_c=[10.0] * days, tmax_c=[22.0] * days, origin=["open_meteo"] * days)
    out = SoilMoistureForecaster.default().predict(weather, parse(payload(), T), None, T)
    assert out["available"] and len(out["points"]) == 14
    assert all(p["delta_p10"] <= p["delta_p50"] <= p["delta_p90"] for p in out["points"])
    from kowr_ml import sm_predict  # app/report.py do czasu scalenia refaktoru

    assert sm_predict.predict(weather, parse(payload(), T), None, T) == out
