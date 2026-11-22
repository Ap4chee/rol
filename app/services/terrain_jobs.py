"""Teren liczony poza głównym raportem: zadanie w tle na działkę, wynik w pamięci podręcznej po identyfikatorze.

Raport uruchamia zadanie od razu po poznaniu działki, a frontend dociąga wynik przez `GET /api/terrain`.
Dwa wywołania dla tej samej działki czekają na to samo zadanie (bez podwójnego pobierania NMT).
"""
from __future__ import annotations

import asyncio
from collections.abc import Callable

import httpx

from app.core import terrain_rules
from app.core.terrain_analysis import TerrainNotComputable, analyse_parcel
from app.infra import cache
from app.infra.http import new_client
from app.presentation.sections.terrain import terrain_failure, terrain_response
from app.schemas import Status, TerrainResponse
from app.sources import NoData, SourceError, terrain
from app.sources.parcels import Parcel

CACHE_NAMESPACE = "terrain"


class TerrainJobs:
    """Trwające zadania terenu po identyfikatorze działki. Jedna instancja na proces serwera."""

    def __init__(self, client_factory: Callable[[], httpx.AsyncClient] = new_client) -> None:
        self._client_factory = client_factory
        self._tasks: dict[str, asyncio.Task] = {}

    def start(self, parcel: Parcel) -> None:
        """Uruchamia liczenie terenu w tle, jeśli wyniku nie ma w pamięci podręcznej i zadanie jeszcze nie trwa."""
        if cache.get(CACHE_NAMESPACE, parcel.id) is not None:
            return
        task = self._tasks.get(parcel.id)
        if task is None or task.done():
            self._tasks[parcel.id] = asyncio.create_task(self._compute(parcel))

    async def get(self, parcel: Parcel) -> TerrainResponse:
        cached = cache.get(CACHE_NAMESPACE, parcel.id)
        if cached is not None:
            response = TerrainResponse(**cached)
            response.source.from_cache = True
            return response
        self.start(parcel)
        try:
            return await asyncio.shield(self._tasks[parcel.id])
        finally:
            task = self._tasks.get(parcel.id)
            if task is not None and task.done():
                self._tasks.pop(parcel.id, None)

    async def _compute(self, parcel: Parcel) -> TerrainResponse:
        try:
            async with self._client_factory() as client:
                window = await terrain.fetch_parcel_dem(client, parcel.geometry)
            # obliczenia trwają ok. sekundy, więc idą do wątku, żeby nie blokować innych zapytań
            analysis = await asyncio.to_thread(analyse_parcel, parcel.geometry, window.dem, window.transform,
                                               window.buffer_m)
        except (NoData, TerrainNotComputable) as exc:
            return terrain_failure(parcel.id, Status.no_data, str(exc))
        except (SourceError, RuntimeError) as exc:
            return terrain_failure(parcel.id, Status.error, str(exc))
        response = terrain_response(parcel.id, analysis, terrain_rules.conclude(analysis.facts), window.fetch_s)
        cache.put(CACHE_NAMESPACE, parcel.id, response.model_dump(mode="json"))
        return response
