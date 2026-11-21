"""Pobieranie danych z zewnętrznych usług. Każdy moduł to zwykłe importowalne funkcje."""
from __future__ import annotations


class SourceError(RuntimeError):
    """Źródło nie odpowiedziało poprawnie (błąd HTTP, limit zapytań, nieczytelna odpowiedź)."""


class NoData(RuntimeError):
    """Źródło odpowiedziało, ale nie ma danych dla tego miejsca lub daty."""
