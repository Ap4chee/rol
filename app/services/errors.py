"""Błędy, przy których raportu nie da się złożyć. Router zamienia je na kod HTTP w app/api/errors.py."""
from __future__ import annotations


class ReportUnavailable(RuntimeError):
    """Raport nie powstanie. Treść wyjątku jest gotowym zdaniem dla rolnika."""


class ParcelNotFound(ReportUnavailable):
    """Ewidencja odpowiedziała, ale takiej działki nie ma."""


class ParcelSourceDown(ReportUnavailable):
    """ULDK i zapasowy WFS nie odpowiedziały, a rolnik nie wskazał punktu, dla którego można liczyć bez granicy."""
