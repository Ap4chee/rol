"""Daty analizy: dzisiejszy dzień w Polsce, dopuszczalny zakres i okno danych, które wolno pobrać."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from app.config import HISTORY_YEARS, WARMUP_DAYS
from app.core.analysis import same_day_years_back

WARSAW = ZoneInfo("Europe/Warsaw")
# Najstarsza data, dla której archiwa pogody i gleby mają komplet z 10 latami wstecz.
MIN_ANALYSIS_DATE = date(2005, 1, 1)


class InvalidAnalysisDate(ValueError):
    """Data analizy z przyszłości albo starsza niż MIN_ANALYSIS_DATE. Treść idzie wprost do rolnika."""


def today_warsaw() -> date:
    return datetime.now(WARSAW).date()


def is_allowed_analysis_date(day: date, today: date) -> bool:
    return MIN_ANALYSIS_DATE <= day <= today


@dataclass(frozen=True)
class AnalysisWindow:
    """Zakres pobieranych dni: od rozbiegu bilansu przed 10 latami do ostatniego dnia, który wolno policzyć."""
    start: date
    end: date


def analysis_window(day: date, today: date) -> AnalysisWindow:
    if day > today:
        raise InvalidAnalysisDate("Data analizy nie może być z przyszłości.")
    if day < MIN_ANALYSIS_DATE:
        raise InvalidAnalysisDate("Data analizy jest zbyt odległa (najwcześniej 01.01.2005).")
    # Dla „dziś” ostatnia pełna doba to wczoraj, dla daty historycznej sama data. Nic późniejszego nie jest pobierane.
    end = day if day < today else today - timedelta(days=1)
    start = same_day_years_back(end, HISTORY_YEARS) - timedelta(days=WARMUP_DAYS)
    return AnalysisWindow(start=start, end=end)
