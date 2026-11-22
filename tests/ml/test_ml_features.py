"""Cechy modelu prognozy NDMI (kowr_ml/features.py) i predykcja z obserwacji aplikacji. Bez sieci.

Najważniejsze: cechy policzone z obserwacji aplikacji (NDMI tylko dla trzech wybranych scen) muszą być takie same
jak w treningu, gdzie wskaźniki mają wszystkie czyste sceny.
"""
import math
from datetime import date, timedelta

import numpy as np
import pytest

from app.sources.sentinel import Observation, choose_for_indices
from app.sources.weather import DailyWeather
from kowr_ml import predict as ml_predict
from kowr_ml.features import FEATURES, FieldScenes, WeatherSeries, feature_row, observation_features, target

T = date(2025, 6, 25)
START = date(2024, 10, 1)


def weather(days: int = 400) -> WeatherSeries:
    dates = [START + timedelta(days=i) for i in range(days)]
    rain = np.zeros(days)
    rain[::10] = 12.0                      # deszcz co 10 dni
    et0 = np.full(days, 3.0)
    tmax = np.full(days, 20.0)
    tmin = np.full(days, 10.0)             # średnia dobowa 15 °C
    return WeatherSeries(dates, rain, et0, tmax, tmin)


# (dni przed T, piksele roślinności, gołej gleby, chmur, NDMI, NDVI) dla pola 20 pikseli
SCENES = [(40, 20, 0, 0, 0.50, 0.80), (33, 20, 0, 0, 0.48, 0.79), (27, 4, 0, 16, None, None), (20, 20, 0, 0, 0.45, 0.78),
          (12, 18, 2, 0, 0.40, 0.74), (9, 16, 4, 0, 0.36, 0.70), (5, 0, 0, 20, None, None), (3, 14, 6, 0, 0.30, 0.62)]


def training_scenes() -> FieldScenes:
    """Jak w treningu: każda czysta scena ma wskaźniki."""
    n = float("nan")
    return FieldScenes.from_columns(
        dates=[T - timedelta(days=d) for d, *_ in SCENES], total_px=[20] * len(SCENES), veg_px=[s[1] for s in SCENES],
        bare_px=[s[2] for s in SCENES], cloud_px=[s[3] for s in SCENES], valid_fraction=[s[1] / 20 for s in SCENES],
        ndmi=[n if s[4] is None else s[4] for s in SCENES], ndvi=[n if s[5] is None else s[5] for s in SCENES],
        nir=[n if s[4] is None else 0.40 for s in SCENES], swir=[n if s[4] is None else 0.20 for s in SCENES],
        red=[n if s[4] is None else 0.07 for s in SCENES])


def app_observations() -> list[Observation]:
    """Jak w aplikacji: SCL dla wszystkich scen, wskaźniki tylko dla trzech wybranych (odstęp co najmniej 7 dni)."""
    obs = [Observation(scene_id=f"S{d}", date=(T - timedelta(days=d)).isoformat(), collection="sentinel-2-c1-l2a",
                       total_pixels=20, valid_pixels=veg, bare_pixels=bare, cloudy_pixels=cloud, accepted=ndmi is not None)
           for d, veg, bare, cloud, ndmi, _ in SCENES]
    chosen = {o.scene_id for o in choose_for_indices([o for o in obs if o.accepted])}
    for o, (_, _, _, _, ndmi, ndvi) in zip(obs, SCENES):
        if o.scene_id in chosen:
            o.ndmi, o.ndvi, o.nir08, o.swir16, o.red = ndmi, ndvi, 0.40, 0.20, 0.07
        else:
            o.accepted = False      # czysta scena pominięta albo scena zachmurzona
    return obs


def test_scene_selection_follows_the_app_rule():
    f = observation_features(training_scenes(), T)
    assert f["ndmi_last"] == 0.30 and f["days_since_last_scene"] == 3
    assert f["ndmi_prev"] == 0.40                      # najnowsza scena starsza o co najmniej 7 dni: sprzed 12 dni, nie 9
    assert f["ndmi_trend_per_day"] == pytest.approx((0.30 - 0.40) / 9)
    assert f["ndmi_trend2_per_day"] == pytest.approx((0.40 - 0.45) / 8)   # jeszcze wcześniejsza: sprzed 20 dni
    assert f["ndmi_accel"] == pytest.approx((0.30 - 0.40) / 9 - (0.40 - 0.45) / 8)
    assert f["ndvi_trend_per_day"] == pytest.approx((0.62 - 0.74) / 9)


def test_scl_history_uses_all_scenes_from_45_days():
    f = observation_features(training_scenes(), T)
    assert f["n_scenes_45d"] == 8 and f["n_clear_45d"] == 6
    assert f["days_since_any_scene"] == 3
    assert f["bare_frac_last"] == pytest.approx(0.30) and f["bare_frac_max_45d"] == pytest.approx(0.30)
    assert f["veg_frac_mean_14d"] == pytest.approx((18 + 16 + 0 + 14) / 4 / 20)
    assert f["cloud_frac_mean_45d"] == pytest.approx((16 + 20) / 8 / 20)


def test_no_scene_in_last_14_days_means_no_features_and_target_needs_future_scene():
    s = training_scenes()
    assert observation_features(s, T + timedelta(days=20)) is None
    assert target(s, T - timedelta(days=20)) == {"ndmi_future": 0.40, "target_index": 4, "target_valid_fraction": 0.9}
    assert target(s, T) is None


def test_one_scene_per_day_prefers_the_one_with_indices():
    day = [T - timedelta(days=3)] * 2
    s = FieldScenes.from_columns(day, [20, 20], [20, 12], [0, 0], [0, 8], [1.0, 0.6], [float("nan"), 0.3],
                                 [float("nan"), 0.6], [float("nan"), 0.4], [float("nan"), 0.2], [float("nan"), 0.07])
    assert len(s.dates) == 1 and s.ndmi[0] == 0.3 and s.veg_px[0] == 12


def test_weather_features_sums_and_thermal_time():
    w = weather()
    last_scene = T - timedelta(days=3)
    f = w.extra_features(T, last_scene)
    days_from_jan1 = (T - date(2025, 1, 1)).days
    assert f["gdd5_jan1"] == pytest.approx(10.0 * days_from_jan1)      # (15 − 5) °C dziennie
    assert f["gdd0_jan1"] == pytest.approx(15.0 * days_from_jan1)
    assert f["gdd5_30d"] == pytest.approx(300.0)
    assert f["tmean_c_7d"] == pytest.approx(15.0) and f["tmin_c_min_7d"] == pytest.approx(10.0)
    i, scene = w.idx(T), w.idx(last_scene)
    assert f["rain_mm_scene_2d"] == pytest.approx(w.rain[scene - 1:scene + 1].sum())
    assert f["rain_mm_since_scene"] == pytest.approx(w.rain[scene + 1:i].sum())
    assert f["et0_mm_since_scene"] == pytest.approx(3.0 * (i - scene - 1))
    # zdjęcie z dnia t-1: od zdjęcia do dnia prognozy nie ma ani jednego pełnego dnia
    assert w.extra_features(T, T - timedelta(days=1))["rain_mm_since_scene"] == 0.0


def test_missing_weather_gives_nan_not_zero():
    dates = [START + timedelta(days=i) for i in range(400)]
    tmin = np.full(400, 10.0)
    tmin[395] = np.nan
    f = WeatherSeries(dates, np.zeros(400), np.full(400, 3.0), np.full(400, 20.0), tmin).extra_features(START + timedelta(days=400), START + timedelta(days=397))
    assert math.isnan(f["tmean_c_7d"]) and math.isnan(f["gdd5_30d"])
    assert f["rain_mm_scene_2d"] == 0.0     # opad jest kompletny, więc suma to prawdziwe 0 mm


def test_app_observations_give_the_same_features_as_training():
    w = weather()
    trained = feature_row(training_scenes(), w, T, 51.09, 22.36)
    served = feature_row(ml_predict.scenes_from_observations(app_observations()), w, T, 51.09, 22.36)
    assert set(FEATURES) <= set(trained)
    for name in FEATURES:
        assert served[name] == pytest.approx(trained[name], nan_ok=True), name


def test_predict_returns_forecast_with_all_model_inputs():
    days = 400
    series = DailyWeather(dates=[START + timedelta(days=i) for i in range(days)], rain_mm=np.where(np.arange(days) % 10 == 0, 12.0, 0.0),
                          et0_mm=np.full(days, 3.0), tmin_c=np.full(days, 10.0), tmax_c=np.full(days, 20.0), origin=["open_meteo"] * days)
    out = ml_predict.predict(app_observations(), series, T, lat=51.09, lon=22.36)
    assert out["available"], out
    models, _ = ml_predict.load(str(ml_predict.default_model_dir()))
    assert list(out["inputs"]) == list(models["features"])
    assert out["delta_p10"] <= out["delta_p50"] <= out["delta_p90"]
    assert out["last_scene_date"] == (T - timedelta(days=3)).isoformat() and out["ndmi_last"] == 0.3


def test_predict_gives_reason_instead_of_forecast():
    series = DailyWeather(dates=[START + timedelta(days=i) for i in range(400)], rain_mm=np.zeros(400), et0_mm=np.full(400, 3.0),
                          tmin_c=np.full(400, 10.0), tmax_c=np.full(400, 20.0), origin=[""] * 400)
    assert "poza okresem" in ml_predict.predict(app_observations(), series, date(2025, 11, 5))["reason"]
    cloudy = [o for o in app_observations() if not o.accepted]
    assert "brak czystego zdjęcia" in ml_predict.predict(cloudy, series, T)["reason"]
    assert "ostatnie czyste zdjęcie" in ml_predict.predict(app_observations(), series, T + timedelta(days=20))["reason"]
