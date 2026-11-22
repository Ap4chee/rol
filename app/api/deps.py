"""Zależności routerów: wspólny klient HTTP, dzisiejszy dzień i serwisy z app.state (podmieniane w testach)."""
from __future__ import annotations

from collections.abc import AsyncIterator
from datetime import date

import httpx
from fastapi import Request

from app.core.dates import today_warsaw
from app.infra.http import new_client
from app.services.field_worker import FieldWorker
from app.services.fieldwork_planner import FieldworkPlanner
from app.services.report_builder import ReportBuilder
from app.services.terrain_jobs import TerrainJobs


async def http_client() -> AsyncIterator[httpx.AsyncClient]:
    async with new_client() as client:
        yield client


def today() -> date:
    return today_warsaw()


def report_builder(request: Request) -> ReportBuilder:
    return request.app.state.report_builder


def field_worker(request: Request) -> FieldWorker:
    return request.app.state.field_worker


def terrain_jobs(request: Request) -> TerrainJobs:
    return request.app.state.terrain_jobs


def fieldwork_planner(request: Request) -> FieldworkPlanner:
    return request.app.state.fieldwork_planner
