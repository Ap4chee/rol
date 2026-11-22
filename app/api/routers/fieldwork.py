"""Plan prac polowych na 7 dni. Plan liczy się zawsze z bieżącej prognozy, także dla raportu historycznego."""
from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query

from app.api.deps import fieldwork_planner, today
from app.api.validators import Lat, Lon
from app.schemas import CropKey, FieldworkResponse
from app.services.fieldwork_planner import FieldworkPlanner, TopsoilTexture

router = APIRouter(prefix="/api")

MAX_SAND_CLAY_PCT = 100.5   # zapas na zaokrąglenie średnich do 0,1


@router.get("/fieldwork", response_model=FieldworkResponse)
async def fieldwork_plan(lon: Lon, lat: Lat, crop: CropKey = Query(),
                         sand: float | None = Query(default=None, ge=0, le=100),
                         clay: float | None = Query(default=None, ge=0, le=100),
                         soc: float | None = Query(default=None, ge=0, le=600),
                         planner: FieldworkPlanner = Depends(fieldwork_planner),
                         day: date = Depends(today)) -> FieldworkResponse:
    """Plan prac na 7 dni od dziś: prognoza Open-Meteo i uziarnienie wierzchu gleby (0–10 cm) z raportu pola."""
    if sand is not None and clay is not None and sand + clay > MAX_SAND_CLAY_PCT:
        raise HTTPException(status_code=422, detail="Piasek i ił razem nie mogą przekraczać 100%.")
    return await planner.plan(lat, lon, crop, TopsoilTexture(sand, clay, soc), day)
