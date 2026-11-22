"""Użytkowanie terenu z liczby pikseli w klasach mapy pokrycia terenu (bez sieci)."""
from app.core.crops import CROPS
from app.core.land_use import summarize
from app.presentation.sections import land_use, sources_info
from app.schemas import Recommendations, Status
from app.sources.worldcover import tile_name

WHEAT, GRASS = CROPS["winter_wheat"], CROPS["grassland"]


def test_arable_parcel_is_farmland_and_matches_arable_crop():
    use = summarize({40: 95, 30: 4, 50: 1}, grassland_crop=False)
    assert use.verdict == "farmland" and use.crop_matches is True
    assert use.dominant.key == "cropland" and abs(use.farmland_share - 0.99) < 1e-9
    assert summarize({40: 95, 30: 5}, grassland_crop=True).crop_matches is False


def test_forest_parcel_is_not_farmland_and_partly_wooded_is_noted():
    forest = summarize({10: 80, 40: 20}, grassland_crop=False)
    assert forest.verdict == "not_farmland" and forest.crop_matches is None
    assert [c.key for c in forest.other] == ["trees"]
    assert summarize({40: 70, 10: 30}, grassland_crop=False).verdict == "partly_other"


def test_no_pixels_and_unknown_codes_give_no_result():
    assert summarize({}, grassland_crop=False) is None
    assert summarize({0: 50, 7: 3}, grassland_crop=False) is None
    assert summarize({40: 4}, grassland_crop=False).coarse


def test_tile_name_is_lower_left_corner_of_3_degree_sheet():
    assert tile_name(22.39, 51.10) == "N51E021"
    assert tile_name(14.2, 53.9) == "N51E012"
    assert tile_name(23.99, 49.01) == "N48E021"


def test_not_farmland_adds_field_check_and_limitation_without_touching_other_recommendations():
    section = land_use.land_use_section({10: 90, 40: 10}, sources_info.land_use_source(), WHEAT, point_only=False)
    recs = Recommendations(status=Status.ok)
    land_use.add_field_check(recs, section, WHEAT)
    assert [r.key for r in recs.field_checks] == ["land_use_not_farmland"]
    assert "10%" in recs.field_checks[0].why and "drzewa i las 90%" in recs.field_checks[0].why
    assert not recs.retention and not recs.agrotechnical
    assert land_use.limitation(section)[0].startswith("Większość działki nie wygląda na grunt rolny")


def test_farmland_adds_nothing_and_missing_map_is_said_plainly():
    section = land_use.land_use_section({30: 100}, sources_info.land_use_source(), GRASS, point_only=False)
    recs = Recommendations(status=Status.ok)
    land_use.add_field_check(recs, section, GRASS)
    assert section.verdict == "farmland" and section.crop_matches is True
    assert not recs.field_checks and land_use.limitation(section) == []

    missing = land_use.land_use_section(None, sources_info.land_use_not_fetched(), WHEAT, point_only=False)
    assert missing.status == Status.no_data and not missing.classes
    assert "Nie sprawdzono, czy działka jest gruntem rolnym" in land_use.limitation(missing)[0]
    assert land_use.assumption(missing) == []
