"""Serwer aplikacji: API raportu i statyczny frontend. Uruchomienie: `uvicorn app.main:app`."""
from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app.report import build_report
from app.schemas import CropKey, CropOption, ReportRequest, ReportResponse

ROOT = Path(__file__).resolve().parent.parent
STATIC_DIR = ROOT / "static"

app = FastAPI(
    title="KOWR – Zatrzymaj wodę, chroń plony",
    description="Raport sytuacji wodnej działki rolnej liczony na żywo z otwartych danych.",
    version="0.1.0",
)

CROP_NAMES: dict[CropKey, str] = {
    CropKey.winter_wheat: "Pszenica ozima",
    CropKey.spring_barley: "Jęczmień jary",
    CropKey.winter_rapeseed: "Rzepak ozimy",
    CropKey.maize: "Kukurydza",
    CropKey.potato: "Ziemniak",
    CropKey.sugar_beet: "Burak cukrowy",
    CropKey.grassland: "Użytki zielone",
}


@app.get("/api/crops", response_model=list[CropOption])
async def crops() -> list[CropOption]:
    """Lista upraw do wyboru w formularzu."""
    return [CropOption(key=key, name=name) for key, name in CROP_NAMES.items()]


@app.post("/api/report", response_model=ReportResponse)
async def report(request: ReportRequest) -> ReportResponse:
    """Raport dla działki (identyfikator albo punkt), uprawy i daty. Liczony na żywo."""
    return await build_report(request)


if STATIC_DIR.is_dir():
    app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
