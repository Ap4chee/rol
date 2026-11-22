"""Podsumowanie na górze raportu, odnośnik do terenu liczonego osobno i raport zastępczy, gdy nie ma pogody."""
from __future__ import annotations

from urllib.parse import urlencode

from app.schemas import (
    CausesSection,
    CropInfo,
    HistorySection,
    Recommendations,
    SatelliteSection,
    Status,
    TerrainRef,
    WaterStatus,
)
from app.sources.parcels import Parcel

NOT_CONNECTED = "Tej części nie policzono, bo raport zatrzymał się na braku pogody."
NO_WEATHER_REASON = ("Żaden dostawca pogody nie odpowiedział. Bez opadu i ewapotranspiracji nie da się policzyć "
                     "bilansu wodnego, więc oceny niedoboru wody nie ma. Spróbuj ponownie za kilka minut.")
NEEDS_BALANCE = "Wymaga bilansu wodnego, a ten nie powstał z powodu braku pogody."


def summary(status: WaterStatus, in_season: bool, recommendations: Recommendations) -> list[str]:
    """2–4 zdania: klasa, najważniejsza liczba, niepewność gleby i pierwsze działanie."""
    out = [status.headline or ""]
    if status.text:
        out.append(status.text[-1] if not in_season else status.text[0])
    if status.uncertainty_text:
        out.append(status.uncertainty_text)
    first = next(iter([*recommendations.retention, *recommendations.agrotechnical]), None)
    if first:
        out.append(f"Najważniejsze działanie: {first.title.lower()}.")
    return out


def terrain_ref(parcel: Parcel | None) -> TerrainRef:
    if parcel is None:
        return TerrainRef(status=Status.no_data, reason="Brak granicy działki (raport dla punktu), więc nie ma "
                                                        "dla czego policzyć spływu.")
    return TerrainRef(status=Status.pending, endpoint="/api/terrain?" + urlencode({"parcel_id": parcel.id}),
                      reason="Spadek i drogi spływu liczą się osobno z modelu terenu (zwykle 15–60 s).")


def no_weather_sections(crop_key, crop_name: str) -> dict:
    """Sekcje raportu, których bez pogody nie da się policzyć, każda z powodem."""
    return dict(
        crop=CropInfo(key=crop_key, name=crop_name, in_season=False),
        summary=[NO_WEATHER_REASON],
        water_status=WaterStatus(status=Status.error, reason=NO_WEATHER_REASON),
        satellite=SatelliteSection(status=Status.no_data, reason=NOT_CONNECTED),
        history=HistorySection(status=Status.no_data, reason=NEEDS_BALANCE),
        causes=CausesSection(status=Status.no_data, reason=NEEDS_BALANCE),
        terrain=TerrainRef(status=Status.no_data, reason=NOT_CONNECTED),
        recommendations=Recommendations(
            status=Status.no_data,
            reason="Rekomendacje powstają dopiero po ocenie sytuacji wodnej, a tej nie udało się policzyć."),
        limitations=[NO_WEATHER_REASON])
