"""Rekomendacje: zebranie faktów działki dla reguł z app/core/recommendations.py i zamiana wyniku na schemat API."""
from __future__ import annotations

from datetime import timedelta

import numpy as np

from app.core import analysis
from app.core import recommendations as rules
from app.core.balance_run import Computed
from app.core.crops import last_completed_season, season_containing, sowing_after
from app.core.soil import Layer
from app.core.textfmt import fmt
from app.presentation.sections.history import LONG_STRESS_DAYS
from app.schemas import (
    HistorySection,
    HydrologySection,
    Recommendation,
    Recommendations,
    SatelliteSection,
    SoilSection,
    Status,
    WaterStatus,
)

TOPSOIL_CM = 30   # węgiel organiczny liczymy dla warstwy ornej


def _topsoil_soc(layers: list[Layer] | None) -> float | None:
    """Średnia zawartość węgla organicznego w 0–30 cm [g/kg], ważona grubością warstw."""
    if not layers:
        return None
    top = [(layer.soc_g_kg, min(layer.bottom_cm, TOPSOIL_CM) - layer.top_cm) for layer in layers
           if layer.top_cm < TOPSOIL_CM and layer.soc_g_kg is not None]
    return sum(v * w for v, w in top) / sum(w for _, w in top) if top else None


def _river_evidence(hydrology: HydrologySection) -> str | None:
    if hydrology.status != Status.ok:
        return None
    return (f"Na wodowskazie {hydrology.station_name} ({hydrology.river}, {fmt(hydrology.station_distance_km)} km "
            f"od działki) wody było mniej niż w tych samych dniach w {hydrology.years_higher} z "
            f"{hydrology.years_compared} poprzednich lat.")


def recommendation_facts(c: Computed, status: WaterStatus, history: HistorySection, soil_layers: list[Layer] | None,
                         soil: SoilSection, satellite: SatelliteSection, satellite_field_check: bool,
                         hydrology: HydrologySection) -> rules.Facts:
    """Policzone wartości działki w postaci, na której działają reguły rekomendacji."""
    crop, last = c.crop, c.dates[-1]
    main = c.assessment  # pełna precyzja; reguły same formatują liczby w tekstach
    variant = c.main_variant
    past = [s for s in history.seasons if s.complete]
    stressed_days = [s.stress_days_critical for s in past if s.stressed]

    harvest_day = next_sowing = bare_days = None
    uses_field_dates = next_sowing_provided = False
    if not crop.perennial:
        season = season_containing(crop, last) or last_completed_season(crop, last)
        harvest_day = season.harvest - timedelta(days=1)
        next_sowing = sowing_after(crop, season)
        bare_days = (next_sowing - harvest_day).days - 1
        uses_field_dates = season == crop.season_override
        next_sowing_provided = uses_field_dates and crop.next_sowing_date is not None
    bare = analysis.bare_period_stats(c.dates, crop, c.main, c.series.rain_mm)

    return rules.Facts(
        crop_key=crop.key, crop_name=crop.name, perennial=crop.perennial, analysis_day=last,
        in_season=c.in_season, stage=c.crop_daily.stage[-1], class_key=main.class_key,
        depletion_mm=main.depletion_mm, raw_mm=main.raw_mm, taw_mm=main.taw_mm,
        variants=[(c.assessments[v.key].depletion_mm, c.assessments[v.key].raw_mm) for v in c.variants],
        spans_classes=status.spans_classes, soil_assumed=status.soil_assumed,
        awc_mm_per_m=(variant.fc_root - variant.wp_root) * 1000.0,
        topsoil_label=soil.layers[0].texture_label if soil.layers else None, soc_0_30_g_kg=_topsoil_soc(soil_layers),
        seasons_total=len(past), seasons_with_stress=len(stressed_days),
        seasons_with_long_stress=sum(1 for d in stressed_days if d >= LONG_STRESS_DAYS),
        median_stress_days=float(np.median(stressed_days)) if stressed_days else None,
        days_to_stress=main.days_to_stress, etc_mm_day=main.etc_mm_day,
        harvest_day=harvest_day, next_sowing_day=next_sowing, bare_period_days=bare_days,
        bare_rain_mm=bare.rain_mm if bare else None, bare_evaporation_mm=bare.evaporation_mm if bare else None,
        bare_from=bare.date_from if bare else None, bare_to=bare.date_to if bare else None,
        uses_field_dates=uses_field_dates, next_sowing_provided=next_sowing_provided,
        satellite_green_cover=satellite.green_cover, satellite_agreement=satellite.agreement,
        satellite_field_check=satellite_field_check,
        watercourse_distance_m=hydrology.nearest_watercourse_distance_m,
        watercourse_name=hydrology.nearest_watercourse_name,
        river_class=hydrology.class_key, river_evidence=_river_evidence(hydrology))


def to_schema(r: rules.Rec) -> Recommendation:
    return Recommendation(key=r.key, category=r.category, title=r.title, what=r.what, where=r.where, why=r.why,
                          confidence=r.confidence, confidence_reason=r.confidence_reason, evidence=r.evidence,
                          timing=r.timing)


def recommendations_section(facts: rules.Facts) -> Recommendations:
    result = rules.build(facts)
    return Recommendations(
        status=Status.ok, retention=[to_schema(r) for r in result.retention],
        agrotechnical=[to_schema(r) for r in result.agrotechnical],
        irrigation=[to_schema(r) for r in result.irrigation], field_checks=[to_schema(r) for r in result.field_checks],
        irrigation_note=result.irrigation_note)
