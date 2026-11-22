from datetime import date, timedelta

from app.core.crops import CROPS
from app.core.fieldwork import best_windows, plan_fieldwork, surface_soil

FC, WP, REW, _ = surface_soil(40.0, 20.0, None)   # glina


def plan(rain, et0, start, crop="maize", n_recent=5, wind=5.0, tmax=18.0, tmin=8.0, codes=None):
    n = len(rain)
    dates = [start + timedelta(days=i) for i in range(n)]
    return plan_fieldwork(dates, rain, et0, [tmax] * n, [tmin] * n, [wind] * n, codes or [3] * n,
                          n_recent, CROPS[crop], FC, WP, REW)


def test_wet_soil_after_rain_with_low_evaporation_blocks_traffic():
    # listopad: 20 mm deszczu, potem parowanie 0,4 mm/dobę – wierzch długo mokry
    days = plan([20, 0, 0, 0, 0] + [0] * 7, [0.4] * 12, date(2026, 11, 10))
    assert days[0]["traffic"]["rating"] == "avoid"
    assert "mokra" in days[0]["traffic"]["reason"]


def test_dry_summer_soil_is_trafficable_and_rain_day_is_not():
    days = plan([0] * 5 + [0, 6, 0, 0, 0, 0, 0], [4.0] * 12, date(2026, 6, 1))
    assert days[0]["traffic"]["rating"] == "good"
    assert days[1]["traffic"]["rating"] == "avoid"
    assert days[0]["surface_fc_pct"] < 90


def test_spraying_rules_and_off_season():
    windy = plan([0] * 12, [4.0] * 12, date(2026, 6, 1), wind=25.0)
    assert windy[0]["spraying"]["rating"] == "avoid"
    assert "wiatr" in windy[0]["spraying"]["reason"]
    # kukurydza w listopadzie jest już zebrana: opryski i nawożenie poza sezonem
    november = plan([0] * 12, [0.5] * 12, date(2026, 11, 10))
    assert november[0]["spraying"]["rating"] == "off"
    assert november[0]["fertilizing"]["rating"] == "off"


def test_sowing_only_in_sowing_window():
    in_window = plan([0] * 12, [3.0] * 12, date(2026, 4, 15))   # kukurydza: umownie 25.04
    assert in_window[0]["sowing"]["rating"] != "off"
    assert plan([0] * 12, [3.0] * 12, date(2026, 7, 1))[0]["sowing"]["rating"] == "off"
    assert plan([0] * 12, [3.0] * 12, date(2026, 4, 15), crop="grassland")[0]["sowing"]["rating"] == "off"


def test_fertilizing_avoided_before_heavy_rain_and_in_cold():
    days = plan([0] * 5 + [0, 15, 10, 0, 0, 0, 0], [4.0] * 12, date(2026, 5, 10))
    assert days[0]["fertilizing"]["rating"] == "avoid"
    cold = plan([0] * 12, [1.0] * 12, date(2026, 4, 1), crop="winter_wheat", tmax=6.0, tmin=-2.0)
    assert cold[0]["fertilizing"]["rating"] == "avoid"
    assert "wegetacja" in cold[0]["fertilizing"]["reason"]


def test_missing_forecast_rain_is_unknown_not_guessed():
    rain = [0] * 5 + [0, None, 0, 0, 0, 0, 0]
    days = plan(rain, [4.0] * 12, date(2026, 6, 1))
    assert days[1]["traffic"]["rating"] == "unknown"
    assert days[3]["traffic"]["rating"] == "unknown"   # stan wierzchu po luce też nieznany


def test_best_window_is_longest_good_run():
    rating = lambda r: {"rating": r, "reason": ""}
    days = [{"date": date(2026, 6, i + 1), **{op: rating(r) for op in ("traffic", "sowing", "spraying", "fertilizing")}}
            for i, r in enumerate(["good", "avoid", "good", "good", "good", "caution", "good"])]
    windows = best_windows(days)
    assert windows["traffic"] == {"date_from": date(2026, 6, 3), "date_to": date(2026, 6, 5)}
    assert best_windows([{**days[1], "date": date(2026, 6, 1)}]) == {}
