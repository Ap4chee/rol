"""Lokalna prognoza pogody na pulpit i zakładkę Pogoda, poza historycznym bilansem raportu."""
from __future__ import annotations

from datetime import date

import httpx
from fastapi import APIRouter, Depends, Query

from app.api.deps import http_client, today
from app.api.errors import source_status
from app.api.validators import Lat, Lon
from app.presentation.sections.forecast import forecast_response
from app.schemas import ForecastResponse
from app.sources import NoData, SourceError
from app.sources.weather import FORECAST_MAX_DAYS, fetch_dashboard_forecast

router = APIRouter(prefix="/api")


@router.get("/forecast", response_model=ForecastResponse)
async def forecast(lon: Lon, lat: Lat, days: int = Query(default=FORECAST_MAX_DAYS, ge=1, le=FORECAST_MAX_DAYS),
                   client: httpx.AsyncClient = Depends(http_client), day: date = Depends(today)) -> ForecastResponse:
    """Prognoza do 16 dni dla współrzędnych pola."""
    try:
        return forecast_response(await fetch_dashboard_forecast(client, lat, lon, day, days=days))
    except (NoData, SourceError) as exc:
        return ForecastResponse(status=source_status(exc), reason=str(exc))
