"""Zamiana wyjątków domenowych na odpowiedzi HTTP, w jednym miejscu dla całego API."""
from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.core.dates import InvalidAnalysisDate
from app.schemas import Status
from app.services.errors import ParcelNotFound, ParcelSourceDown
from app.sources import NoData

STATUS_CODES: dict[type[Exception], int] = {
    ParcelNotFound: 404,
    ParcelSourceDown: 502,
    InvalidAnalysisDate: 422,
}


def source_status(exc: Exception) -> Status:
    """Źródło bez danych dla tego miejsca to „no_data”, każdy inny błąd źródła to „error”."""
    return Status.no_data if isinstance(exc, NoData) else Status.error


def install(app: FastAPI) -> None:
    async def handle(_request: Request, exc: Exception) -> JSONResponse:
        return JSONResponse(status_code=STATUS_CODES[type(exc)], content={"detail": str(exc)})

    for exc_type in STATUS_CODES:
        app.add_exception_handler(exc_type, handle)
