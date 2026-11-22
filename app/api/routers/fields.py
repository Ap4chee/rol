"""Pola zapisane na serwerze. Raporty liczy worker w tle (app/services/field_worker.py)."""
from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query

from app.api.deps import field_worker, today
from app.api.validators import FieldId
from app.core.dates import is_allowed_analysis_date
from app.schemas import FieldInput, SavedField
from app.services.field_worker import FieldWorker

router = APIRouter(prefix="/api/fields")


@router.get("", response_model=list[SavedField])
async def list_fields(worker: FieldWorker = Depends(field_worker)) -> list[SavedField]:
    """Zapisane pola z ostatnim raportem i stanem liczenia (`job`). Raporty liczy worker w tle."""
    return await worker.list_fields()


@router.post("", response_model=SavedField)
async def save_field(body: FieldInput, previous_id: str | None = Query(default=None, max_length=120),
                     worker: FieldWorker = Depends(field_worker), day: date = Depends(today)) -> SavedField:
    """Dodaje albo zmienia pole (`previous_id`: identyfikator pola przed zmianą działki). Odpowiada od razu,
    raport liczy się w tle, a potem raz na dobę."""
    if body.date is not None and not is_allowed_analysis_date(body.date, day):
        raise HTTPException(status_code=422, detail="Data analizy musi być między 01.01.2005 a dzisiejszym dniem.")
    return await worker.save_field(body, previous_id)


@router.delete("")
async def delete_field(id: FieldId, worker: FieldWorker = Depends(field_worker)) -> dict:
    if not await worker.delete_field(id):
        raise HTTPException(status_code=404, detail="Nie ma takiego pola.")
    return {"deleted": id}
