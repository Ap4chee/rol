"""Reguły rekomendacji: warunki na policzonych wartościach i narzucona kolejność. Bez sieci."""
from dataclasses import replace
from datetime import date

from app.core.recommendations import Facts, build

BASE = Facts(
    crop_key="spring_barley", crop_name="Jęczmień jary", perennial=False, analysis_day=date(2018, 6, 20),
    in_season=True, stage="mid", class_key="moderate", depletion_mm=52.0, raw_mm=36.0, taw_mm=70.0,
    variants=[(52.0, 36.0), (27.0, 20.0), (94.0, 61.0)], spans_classes=True, soil_assumed=False,
    awc_mm_per_m=70.0, topsoil_label="glina piaszczysta", soc_0_30_g_kg=9.0,
    seasons_total=10, seasons_with_stress=9, seasons_with_long_stress=7, median_stress_days=30.0,
    days_to_stress=None, etc_mm_day=4.2, harvest_day=date(2018, 8, 13), next_sowing_day=date(2019, 4, 1),
    bare_period_days=231, bare_rain_mm=300.0, bare_evaporation_mm=170.0,
    bare_from=date(2017, 8, 14), bare_to=date(2018, 3, 31))


def keys(items):
    return [r.key for r in items]


def test_stressed_light_vulnerable_field_gets_all_groups_in_order():
    result = build(BASE)
    assert "cover_crop" in keys(result.retention)
    assert "organic_matter" in keys(result.retention)
    assert {"reduced_tillage", "crop_choice", "limit_operations_now", "monitor_field"} <= set(keys(result.agrotechnical))
    assert keys(result.irrigation) == ["irrigation_optional"]
    assert "check_soil_texture" in keys(result.field_checks)      # przedział obejmuje dwie klasy
    irrigation = result.irrigation[0]
    assert "16 mm" in irrigation.what and "52 mm" in irrigation.what   # do progu RAW i do pełnego zapasu
    assert "od 7 do 33 mm" in irrigation.confidence_reason              # przedział dla wariantów gleby
    assert irrigation.confidence == "niska"


def test_every_recommendation_has_what_where_why_and_confidence_with_parcel_values():
    result = build(BASE)
    for rec in [*result.retention, *result.agrotechnical, *result.irrigation, *result.field_checks]:
        assert rec.what and rec.where and rec.why and rec.confidence_reason
        assert rec.confidence in ("wysoka", "średnia", "niska")
    cover = next(r for r in result.retention if r.key == "cover_crop")
    assert "300 mm" in cover.why and "170 mm" in cover.why and "57%" in cover.why


def test_no_deficit_means_no_irrigation():
    facts = replace(BASE, class_key="none", depletion_mm=5.0, spans_classes=False, variants=[(5.0, 36.0)])
    result = build(facts)
    assert result.irrigation == []
    assert "nie jest teraz potrzebne" in result.irrigation_note
    assert "limit_operations_now" not in keys(result.agrotechnical)


def test_ripening_crop_is_not_irrigated():
    result = build(replace(BASE, stage="late"))
    assert result.irrigation == []
    assert "dojrzewa" in result.irrigation_note


def test_out_of_season_has_no_irrigation_and_no_in_season_actions():
    facts = replace(BASE, in_season=False, stage="off_season", analysis_day=date(2018, 11, 20))
    result = build(facts)
    assert result.irrigation == []
    assert "nie jest teraz w okresie wzrostu" in result.irrigation_note
    assert "monitor_field" not in keys(result.agrotechnical)


def test_good_soil_without_stress_history_gets_no_soil_retention_advice():
    facts = replace(BASE, class_key="none", depletion_mm=10.0, raw_mm=80.0, taw_mm=150.0, spans_classes=False,
                    variants=[(10.0, 80.0)], awc_mm_per_m=150.0, soc_0_30_g_kg=20.0,
                    seasons_with_stress=1, seasons_with_long_stress=0, bare_rain_mm=300.0, bare_evaporation_mm=90.0)
    result = build(facts)
    # Bez porad glebowych, ale retencja nie jest pusta: zostaje działanie zapobiegawcze z liczbami działki.
    assert keys(result.retention) == ["keep_water_preventive"]
    assert "10 mm" in result.retention[0].why and "150 mm" in result.retention[0].why
    assert "1 z 10" in result.retention[0].why
    assert result.agrotechnical == []
    assert result.field_checks == []


def test_preventive_retention_only_when_no_other_retention_rule_fires():
    assert "keep_water_preventive" not in keys(build(BASE).retention)


def test_late_harvest_or_short_gap_gives_residue_instead_of_catch_crop():
    maize = replace(BASE, crop_key="maize", crop_name="Kukurydza", harvest_day=date(2018, 10, 11),
                    next_sowing_day=date(2019, 4, 25), bare_period_days=196)
    assert "residue_cover" in keys(build(maize).retention)
    assert "cover_crop" not in keys(build(maize).retention)
    wheat = replace(BASE, crop_key="winter_wheat", crop_name="Pszenica ozima", harvest_day=date(2018, 7, 30),
                    next_sowing_day=date(2018, 9, 25), bare_period_days=57)
    assert "residue_cover" in keys(build(wheat).retention)


def test_visible_green_cover_turns_recommendation_into_field_check():
    facts = replace(BASE, in_season=False, stage="off_season", satellite_green_cover=True)
    result = build(facts)
    assert "cover_crop" not in keys(result.retention)
    assert "cover_already_present" in keys(result.field_checks)


def test_bare_field_on_satellite_raises_confidence():
    facts = replace(BASE, in_season=False, stage="off_season", satellite_green_cover=False)
    cover = next(r for r in build(facts).retention if r.key == "cover_crop")
    assert cover.confidence == "wysoka"


def test_watercourse_next_to_parcel_gives_buffer_strip():
    result = build(replace(BASE, watercourse_distance_m=8.0, watercourse_name="Nędznica"))
    strip = next(r for r in result.retention if r.key == "buffer_strip_watercourse")
    assert "Nędznica" in strip.where and "8 m" in strip.why
    assert "buffer_strip_watercourse" not in keys(build(replace(BASE, watercourse_distance_m=350.0)).retention)


def test_satellite_divergence_and_missing_soil_become_field_checks():
    result = build(replace(BASE, satellite_field_check=True, soil_assumed=True, spans_classes=False))
    assert {"satellite_divergence", "check_soil_texture"} <= set(keys(result.field_checks))
    assert "organic_matter" not in keys(result.retention)   # bez danych o glebie nie ma rekomendacji glebowej


def test_grassland_gets_no_bare_soil_or_tillage_rules():
    facts = replace(BASE, crop_key="grassland", crop_name="Użytki zielone", perennial=True, harvest_day=None,
                    next_sowing_day=None, bare_period_days=None, bare_rain_mm=None, bare_evaporation_mm=None)
    result = build(facts)
    assert "cover_crop" not in keys(result.retention) and "residue_cover" not in keys(result.retention)
    assert "reduced_tillage" not in keys(result.agrotechnical)


def test_potato_uses_planting_wording_and_skips_no_till():
    facts = replace(BASE, crop_key="potato", crop_name="Ziemniak", harvest_day=date(2018, 9, 10),
                    next_sowing_day=date(2019, 4, 20), bare_period_days=221)
    result = build(facts)
    assert "reduced_tillage" not in keys(result.agrotechnical)
    cover = next(r for r in result.retention if r.key == "cover_crop")
    assert "ścierniskowy" not in cover.what and "sadzenia" in cover.why
    choice = next(r for r in result.agrotechnical if r.key == "crop_choice")
    assert "sadź" in choice.what and "siej" not in choice.what


def test_large_depletion_irrigation_splits_into_20_30_mm_doses():
    facts = replace(BASE, depletion_mm=119.0, raw_mm=60.0, taw_mm=150.0, variants=[(119.0, 60.0)])
    rec = build(facts).irrigation[0]
    assert "20–30 mm" in rec.what
    assert "5 dawek po 25 mm" in rec.what
    assert "Jednorazowo nie podawaj więcej niż 119 mm" not in rec.what
