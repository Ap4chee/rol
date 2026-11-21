"""Zgodność wskaźników satelitarnych z bilansem i wybór scen do wskaźników. Bez sieci."""
from datetime import date

from app.core.satellite_logic import IndexPoint, assess
from app.sources.sentinel import MAX_BAND_SCENES, Observation, choose_for_indices

DAY = date(2025, 6, 25)


def points(first_ndmi, last_ndmi, first_ndvi=0.85, last_ndvi=0.85):
    return [IndexPoint(date(2025, 6, 4), first_ndvi, first_ndmi), IndexPoint(date(2025, 6, 21), last_ndvi, last_ndmi)]


def test_falling_ndmi_confirms_deficit():
    result = assess(points(0.59, 0.50), DAY, in_season=True, stage="mid", class_key="moderate", crop_name="Pszenica ozima")
    assert result.agreement == "confirms"
    assert round(result.ndmi_change, 2) == -0.09


def test_stable_ndmi_diverges_from_deficit_and_asks_for_field_check():
    result = assess(points(0.55, 0.56), DAY, in_season=True, stage="mid", class_key="severe", crop_name="Kukurydza")
    assert result.agreement == "diverges"
    assert result.field_check


def test_no_deficit_and_stable_indices_confirm():
    result = assess(points(0.55, 0.54), DAY, in_season=True, stage="development", class_key="none", crop_name="Kukurydza")
    assert result.agreement == "confirms"
    assert not result.field_check


def test_no_deficit_but_both_indices_fall_in_growth_stage_diverges():
    result = assess(points(0.55, 0.45, 0.85, 0.70), DAY, in_season=True, stage="mid", class_key="watch", crop_name="Burak cukrowy")
    assert result.agreement == "diverges"


def test_ripening_is_not_read_as_drought():
    result = assess(points(0.55, 0.40, 0.85, 0.60), DAY, in_season=True, stage="late", class_key="none", crop_name="Jęczmień jary")
    assert result.agreement == "confirms"
    assert "dojrzewaniem" in result.text[-1]


def test_off_season_is_never_interpreted():
    result = assess(points(0.30, 0.10), DAY, in_season=False, stage="off_season", class_key="moderate", crop_name="Kukurydza")
    assert result.agreement == "inconclusive"


def test_single_observation_is_inconclusive():
    result = assess([IndexPoint(date(2025, 6, 21), 0.86, 0.54)], DAY, True, "mid", "moderate", "Pszenica ozima")
    assert result.agreement == "inconclusive"
    assert result.ndmi_change is None


def test_scenes_for_indices_are_latest_and_spaced():
    days = ["2025-05-13", "2025-05-30", "2025-06-01", "2025-06-04", "2025-06-07", "2025-06-12", "2025-06-14", "2025-06-21"]
    accepted = [Observation(scene_id=f"S_{d}", date=d, collection="c", total_pixels=11, valid_pixels=11, accepted=True)
                for d in days]
    chosen = [o.date for o in choose_for_indices(accepted)]
    assert chosen == ["2025-06-21", "2025-06-14", "2025-06-07"]
    assert len(chosen) == MAX_BAND_SCENES
    assert [o.date for o in choose_for_indices(accepted[:1])] == ["2025-05-13"]
