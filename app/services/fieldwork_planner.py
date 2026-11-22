"""Plan prac polowych na 7 dni od dziś: bieżąca prognoza Open-Meteo i uziarnienie wierzchu gleby z raportu pola.

Reguły ocen są w app/core/fieldwork.py; tu tylko pobranie prognozy i złożenie odpowiedzi.
"""
from __future__ import annotations

from collections.abc import Callable
from dataclasses import asdict, dataclass
from datetime import date

import httpx

from app.core import fieldwork
from app.core.crops import CROPS
from app.infra.http import new_client
from app.schemas import CropKey, FieldworkDay, FieldworkResponse, FieldworkWindow, Status
from app.sources import NoData, SourceError
from app.sources.weather import DashboardForecast, fetch_dashboard_forecast

PLAN_DAYS = 7   # plan prac zawsze na 7 dni (prognoza na pulpit ma do 16)


@dataclass(frozen=True)
class TopsoilTexture:
    """Uziarnienie wierzchu 0–10 cm z raportu pola [%] i węgiel organiczny [g/kg]; None = brak danych o glebie."""
    sand_pct: float | None
    clay_pct: float | None
    soc_g_kg: float | None


class FieldworkPlanner:
    def __init__(self, client_factory: Callable[[], httpx.AsyncClient] = new_client) -> None:
        self._client_factory = client_factory

    async def plan(self, lat: float, lon: float, crop: CropKey, soil: TopsoilTexture, today: date) -> FieldworkResponse:
        async with self._client_factory() as client:
            try:
                forecast = await fetch_dashboard_forecast(client, lat, lon, today, days=PLAN_DAYS)
            except (NoData, SourceError) as exc:
                return FieldworkResponse(status=Status.no_data if isinstance(exc, NoData) else Status.error,
                                         reason=f"Brak prognozy pogody: {exc}", crop=crop)
        return plan_from_forecast(forecast, crop, soil)


def plan_from_forecast(forecast: DashboardForecast, crop: CropKey, soil: TopsoilTexture) -> FieldworkResponse:
    fc, wp, rew, soil_assumed = fieldwork.surface_soil(soil.sand_pct, soil.clay_pct, soil.soc_g_kg)
    rows = [*forecast.recent, *forecast.days]
    days = fieldwork.plan_fieldwork(
        [d.date for d in rows], [d.precipitation_mm for d in rows], [d.et0_mm for d in rows],
        [d.temperature_max_c for d in rows], [d.temperature_min_c for d in rows], [d.wind_max_kmh for d in rows],
        [d.weather_code for d in rows], len(forecast.recent), CROPS[crop.value], fc, wp, rew)
    notes: list[str] = []   # tylko braki danych; ograniczenia planu opisuje README
    if soil_assumed:
        notes.insert(0, "Brak danych o glebie pola: wilgotność wierzchu policzona dla gleby umownej (glina).")
    if not forecast.past_days_complete:
        notes.insert(0, "Brakuje części danych o opadzie z ostatnich 30 dni, więc wilgotności gleby nie oceniono.")
    return FieldworkResponse(
        status=Status.ok, crop=crop, soil_assumed=soil_assumed, days=[FieldworkDay(**asdict(d)) for d in days],
        windows={op: FieldworkWindow(**asdict(w)) for op, w in fieldwork.best_windows(days).items()}, notes=notes)
