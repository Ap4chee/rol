"""Teren i spływ w odpowiedzi API: wnioski z reguł terenu, drogi spływu jako GeoJSON i opis źródła NMT."""
from __future__ import annotations

from app.core.terrain_analysis import TerrainAnalysis
from app.core.terrain_rules import TerrainConclusions
from app.presentation.sections.sources_info import NO_TERRAIN_IMPACT, terrain_source
from app.schemas import Cause, Recommendation, Status, TerrainResponse


def terrain_failure(parcel_id: str, status: Status, reason: str) -> TerrainResponse:
    return TerrainResponse(status=status, reason=reason, parcel_id=parcel_id,
                           source=terrain_source(status, reason), limitations=[NO_TERRAIN_IMPACT])


def parcel_failure(parcel_id: str, reason: str) -> TerrainResponse:
    """Nie ma granicy działki, więc nie ma dla czego liczyć spływu."""
    return TerrainResponse(status=Status.error, reason=f"Nie udało się pobrać granic działki: {reason}",
                           parcel_id=parcel_id, source=terrain_source(Status.error, reason))


def terrain_response(parcel_id: str, analysis: TerrainAnalysis, conclusions: TerrainConclusions,
                     fetch_s: float) -> TerrainResponse:
    facts = analysis.facts
    notes = [f"Wycinek z buforem {analysis.buffer_m:.0f} m wokół działki, komórka {analysis.cell_m:.0f} m. "
             f"Pobranie {fetch_s:.1f} s, obliczenia {analysis.compute_s:.1f} s.".replace(".", ",", 2)]
    return TerrainResponse(
        status=Status.ok, parcel_id=parcel_id,
        source=terrain_source(Status.ok, elapsed_s=round(fetch_s + analysis.compute_s, 2), notes=notes),
        elevation_min_m=round(facts.elevation_min_m, 2), elevation_max_m=round(facts.elevation_max_m, 2),
        slope_mean_pct=round(facts.slope_mean_pct, 1), slope_p90_pct=round(facts.slope_p90_pct, 1),
        threshold_ha=facts.threshold_ha, flow_paths=analysis.flow_paths, crossings=analysis.crossings,
        causes=[Cause(key=key, title=title, text=text) for key, title, text in conclusions.causes],
        recommendations=[Recommendation(key=r.key, category=r.category, title=r.title, what=r.what, where=r.where,
                                        why=r.why, confidence=r.confidence, confidence_reason=r.confidence_reason)
                         for r in conclusions.recommendations],
        text=conclusions.text, limitations=conclusions.limitations)
