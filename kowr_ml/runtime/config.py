"""Definicja cech i etykiety modelu NDMI: okna dni i progi wspólne dla treningu i predykcji.

Zmiana wartości tutaj zmienia znaczenie cech, więc wymaga nowej tabeli i nowego modelu. Progi scen Sentinel-2
bierzemy z aplikacji, żeby trening liczył czyste sceny tak samo jak raport. Parametry samego treningu
(skupiska, sezony, ścieżki danych) są w kowr_ml/pipeline/config.py.
"""
from __future__ import annotations

from app.sources.sentinel import MIN_COVERAGE, MIN_PIXELS
from app.sources.sentinel import MIN_SCENE_SPACING_DAYS as SCENE_SPACING_DAYS
from app.sources.sentinel import WINDOW_DAYS as APP_WINDOW_DAYS

__all__ = ["APP_WINDOW_DAYS", "GDD_BASE_C", "ISSUE_FIRST", "ISSUE_LAST", "LAST_WINDOW_DAYS", "MIN_COVERAGE",
           "MIN_PIXELS", "REF_P", "REF_TAW_MM", "SCENE_SPACING_DAYS", "TARGET_WINDOW_DAYS", "TREND_WINDOW_DAYS"]

# Okres, na którym model był uczony (dni prognozy w sezonie); poza nim zmiana NDMI nie mówi o stanie upraw.
ISSUE_FIRST = "04-01"
ISSUE_LAST = "10-15"
LAST_WINDOW_DAYS = (1, 14)      # obserwacja bazowa w t-14 … t-1
TARGET_WINDOW_DAYS = (7, 14)    # obserwacja docelowa w t+7 … t+14
# Poprzednia obserwacja (do trendu): najnowsza 7–30 dni przed bazową. Dolna granica 7 dni odpowiada
# wyborowi scen w aplikacji (app/sources/sentinel.py, choose_for_indices: sceny co najmniej 7 dni od siebie).
TREND_WINDOW_DAYS = (7, 30)

# Referencyjny bilans wiadra (FAO-56, Kc = 1): wskaźnik suchości niezależny od gleby i uprawy,
# bo w treningu nie znamy ani jednej, ani drugiej. Nie jest to bilans działki z aplikacji.
REF_TAW_MM = 100.0
REF_P = 0.5
GDD_BASE_C = 5.0                # próg sumy temperatur efektywnych
