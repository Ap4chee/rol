"""Cechy modelu wilgotności gleby nie mogą widzieć danych z przyszłości: θ tylko do t−6, pogoda tylko do t−1."""
from datetime import date, timedelta

import numpy as np

from kowr_ml.features import WeatherSeries
from kowr_ml.sm_dataset import SM_LAG_DAYS, sm_feature_row

START = date(2020, 1, 1)
N = 400


def make(rng, sm_root=None):
    days = [START + timedelta(days=i) for i in range(N)]
    weather = WeatherSeries(days, rng.gamma(0.5, 4.0, N), rng.uniform(0.5, 5.0, N), rng.uniform(5, 30, N))
    root = rng.uniform(0.2, 0.35, N) if sm_root is None else sm_root
    return root, root - 0.02, weather


def test_features_ignore_future():
    rng = np.random.default_rng(0)
    root, top, weather = make(rng)
    t = START + timedelta(days=300)
    base = sm_feature_row(START, root, top, weather, t)
    assert base is not None and base["sm_last"] == root[300 - SM_LAG_DAYS]

    i_t = (t - START).days
    root2, top2 = root.copy(), top.copy()
    root2[i_t - SM_LAG_DAYS + 1:] = 0.9          # wilgotność po t−6
    top2[i_t - SM_LAG_DAYS + 1:] = 0.9
    weather.rain[i_t:] = 500.0                    # pogoda od dnia t
    weather.et0[i_t:] = 50.0
    assert sm_feature_row(START, root2, top2, weather, t) == base


def test_missing_inputs_give_none():
    rng = np.random.default_rng(1)
    root, top, weather = make(rng)
    assert sm_feature_row(START, root, top, weather, START + timedelta(days=10)) is None   # brak 30 dni pogody i t−13
    root[300 - SM_LAG_DAYS] = np.nan
    assert sm_feature_row(START, root, top, weather, START + timedelta(days=300)) is None
