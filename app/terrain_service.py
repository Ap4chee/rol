"""Teren liczony poza głównym raportem: zadanie w tle na działkę, wynik w pamięci podręcznej po identyfikatorze.

Raport uruchamia zadanie od razu po poznaniu działki, a frontend dociąga wynik przez `GET /api/terrain`.
Dwa wywołania dla tej samej działki czekają na to samo zadanie (bez podwójnego pobierania NMT).
"""
from __future__ import annotations

import asyncio

import httpx

from app.config import USER_AGENT
from app.core import terrain_rules
from app.infra import cache
from app.schemas import Cause, Recommendation, SourceInfo, Status, TerrainResponse
from app.sources import NoData, SourceError, parcels, terrain

_tasks: dict[str, asyncio.Task] = {}
NO_TERRAIN_IMPACT = ("Bez modelu terenu raport nie ocenia spadku ani dróg spływu. "
                     "Bilans wodny i pozostałe rekomendacje nie zależą od tego źródła.")


def _source(status: Status, reason: str | None = None, elapsed_s: float | None = None, notes: list[str] | None = None,
            from_cache: bool = False) -> SourceInfo:
    return SourceInfo(
        key="terrain", name="Numeryczny model terenu GUGiK (NMT, WCS)", status=status, reason=reason,
        impact=None if status == Status.ok else NO_TERRAIN_IMPACT, resolution="siatka 1 m, układ PL-1992 (EPSG:2180)",
        data_date="stan zasobu GUGiK w dniu pobrania (pomiary lotnicze z różnych lat)",
        license="dane państwowego zasobu geodezyjnego udostępniane bezpłatnie",
        url="https://www.geoportal.gov.pl/pl/dane/numeryczny-model-terenu-nmt/", elapsed_s=elapsed_s,
        from_cache=from_cache, notes=notes or [])


async def _compute(parcel: parcels.Parcel) -> TerrainResponse:
    try:
        async with httpx.AsyncClient(headers={"User-Agent": USER_AGENT}, follow_redirects=True) as client:
            analysis = await terrain.terrain_for_parcel(client, parcel.geometry)
    except NoData as exc:
        return TerrainResponse(status=Status.no_data, reason=str(exc), parcel_id=parcel.id,
                               source=_source(Status.no_data, str(exc)), limitations=[NO_TERRAIN_IMPACT])
    except (SourceError, RuntimeError) as exc:
        return TerrainResponse(status=Status.error, reason=str(exc), parcel_id=parcel.id,
                               source=_source(Status.error, str(exc)), limitations=[NO_TERRAIN_IMPACT])
    facts = analysis.facts
    conclusions = terrain_rules.conclude(facts)
    notes = [f"Wycinek z buforem {analysis.buffer_m:.0f} m wokół działki, komórka {analysis.cell_m:.0f} m. "
             f"Pobranie {analysis.fetch_s:.1f} s, obliczenia {analysis.compute_s:.1f} s.".replace(".", ",", 2)]
    response = TerrainResponse(
        status=Status.ok, parcel_id=parcel.id,
        source=_source(Status.ok, elapsed_s=round(analysis.fetch_s + analysis.compute_s, 2), notes=notes),
        elevation_min_m=round(facts.elevation_min_m, 2), elevation_max_m=round(facts.elevation_max_m, 2),
        slope_mean_pct=round(facts.slope_mean_pct, 1), slope_p90_pct=round(facts.slope_p90_pct, 1),
        threshold_ha=facts.threshold_ha, flow_paths=analysis.flow_paths, crossings=analysis.crossings,
        causes=[Cause(key=key, title=title, text=text) for key, title, text in conclusions.causes],
        recommendations=[Recommendation(key=r.key, category=r.category, title=r.title, what=r.what, where=r.where,
                                        why=r.why, confidence=r.confidence, confidence_reason=r.confidence_reason)
                         for r in conclusions.recommendations],
        text=conclusions.text, limitations=conclusions.limitations)
    cache.put("terrain", parcel.id, response.model_dump(mode="json"))
    return response


def start(parcel: parcels.Parcel) -> None:
    """Uruchamia liczenie terenu w tle, jeśli wyniku nie ma w pamięci podręcznej i zadanie jeszcze nie trwa."""
    if cache.get("terrain", parcel.id) is not None:
        return
    task = _tasks.get(parcel.id)
    if task is None or task.done():
        _tasks[parcel.id] = asyncio.create_task(_compute(parcel))


async def get(parcel: parcels.Parcel) -> TerrainResponse:
    cached = cache.get("terrain", parcel.id)
    if cached is not None:
        response = TerrainResponse(**cached)
        response.source.from_cache = True
        return response
    start(parcel)
    try:
        return await asyncio.shield(_tasks[parcel.id])
    finally:
        task = _tasks.get(parcel.id)
        if task is not None and task.done():
            _tasks.pop(parcel.id, None)
