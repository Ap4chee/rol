"""Czy obserwacje satelitarne potwierdzają bilans wodny, czy się z nim rozchodzą.

Wskaźników nie interpretujemy osobno: NDVI i NDMI służą tylko do sprawdzenia bilansu, z uwzględnieniem
uprawy i fazy sezonu. Progi zmian są parametrami roboczymi (nie pochodzą z publikacji) i są jawne.
Funkcje są czyste: przyjmują policzone wartości, nie sięgają do sieci.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from app.core.textfmt import fmt, fmt_date, plural_days

NDMI_DROP = 0.03          # spadek NDMI uznawany za sygnał utraty wody przez rośliny
STRONG_DROP = 0.05        # wyraźny spadek NDMI i NDVI przy braku niedoboru w bilansie = rozbieżność
MIN_TREND_DAYS = 7        # najkrótszy odstęp między zdjęciami, dla którego oceniamy zmianę


@dataclass
class IndexPoint:
    day: date
    ndvi: float | None
    ndmi: float


@dataclass
class Assessment:
    agreement: str            # confirms | diverges | inconclusive
    text: list[str]
    ndmi_change: float | None = None
    ndvi_change: float | None = None
    field_check: bool = False  # czy rozbieżność uzasadnia oględziny pola


def assess(points: list[IndexPoint], analysis_day: date, in_season: bool, stage: str, class_key: str,
           crop_name: str) -> Assessment:
    """Ocena zgodności wskaźników z bilansem.

    points     – obserwacje z policzonymi wskaźnikami, w dowolnej kolejności
    in_season  – czy uprawa jest w okresie wzrostu
    stage      – faza uprawy: initial | development | mid | late | dormant | off_season
    class_key  – klasa bilansu: none | watch | moderate | severe
    """
    # Data i wartości najnowszego zdjęcia są w odczycie nad tekstem (frontend), więc tekst ich nie powtarza.
    points = sorted(points, key=lambda p: p.day)
    latest = points[-1]
    first = next((p for p in points if (latest.day - p.day).days >= MIN_TREND_DAYS), None)
    d_ndmi = latest.ndmi - first.ndmi if first else None
    d_ndvi = latest.ndvi - first.ndvi if first and latest.ndvi is not None and first.ndvi is not None else None
    if not in_season:
        # Poza okresem wzrostu zmiany wskaźników opisują okrywę pola, a nie wodę dla uprawy: bez wniosku i bez tekstu.
        # Czy pole jest okryte, mówi satellite_section i rekomendacje (okrywa / międzyplon).
        return Assessment("inconclusive", [], d_ndmi, d_ndvi)
    if first is None:
        return Assessment("inconclusive", [
            "Jest tylko jedno czyste zdjęcie w ostatnich 45 dniach, więc nie da się ocenić zmiany w czasie. "
            "Pojedyncza wartość wskaźnika nie rozstrzyga, czy bilans jest trafny."])

    days = (latest.day - first.day).days
    change = (f"Między {fmt_date(first.day)} a {fmt_date(latest.day)} ({plural_days(days)}) NDMI zmienił się z "
              f"{fmt(first.ndmi, 2)} na {fmt(latest.ndmi, 2)}")
    if d_ndvi is not None:
        change += f", a NDVI z {fmt(first.ndvi, 2)} na {fmt(latest.ndvi, 2)}"
    text = [change + "."]

    stressed = class_key in ("moderate", "severe")

    if stressed:
        if d_ndmi <= -NDMI_DROP:
            text.append("Rośliny tracą wodę: spadek NDMI potwierdza niedobór pokazany przez bilans.")
            return Assessment("confirms", text, d_ndmi, d_ndvi)
        if stage == "late":
            text.append("Uprawa dojrzewa, a wskaźniki się nie obniżyły. W tej fazie ich zmiany zależą głównie od "
                        "dojrzewania, więc nie potwierdzają ani nie podważają bilansu.")
            return Assessment("inconclusive", text, d_ndmi, d_ndvi)
        text.append("Bilans pokazuje niedobór, ale na zdjęciach rośliny nie tracą uwilgotnienia: wyniki się rozchodzą. "
                    "Możliwe powody: lokalny deszcz, którego nie widzi siatka pogody, płytka woda gruntowa, nawadnianie "
                    "albo korzenie sięgające głębiej, niż przyjęto. Warto obejrzeć pole.")
        return Assessment("diverges", text, d_ndmi, d_ndvi, field_check=True)

    if stage in ("development", "mid") and d_ndmi <= -STRONG_DROP and d_ndvi is not None and d_ndvi <= -STRONG_DROP:
        text.append("Bilans nie pokazuje niedoboru, a oba wskaźniki wyraźnie spadły w fazie, w której powinny rosnąć albo "
                    "się utrzymywać: wyniki się rozchodzą. Przyczyną może być lokalnie mniejszy opad, lżejsza gleba niż na "
                    "mapie, choroba, szkodniki, wymoknięcie albo koszenie. Warto obejrzeć pole.")
        return Assessment("diverges", text, d_ndmi, d_ndvi, field_check=True)
    if stage == "late" and d_ndmi <= -NDMI_DROP:
        text.append("Spadek wskaźników jest zgodny z dojrzewaniem uprawy i nie świadczy o niedoborze wody: "
                    "nie przeczy bilansowi.")
        return Assessment("confirms", text, d_ndmi, d_ndvi)
    text.append("Wskaźniki nie pokazują pogorszenia stanu roślin, co jest zgodne z bilansem (brak niedoboru).")
    return Assessment("confirms", text, d_ndmi, d_ndvi)
