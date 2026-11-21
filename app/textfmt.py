"""Formatowanie liczb i dat w tekstach raportu (polski zapis: przecinek dziesiętny, dd.mm.rrrr)."""
from __future__ import annotations

from datetime import date


def fmt(value: float, decimals: int = 0) -> str:
    text = f"{value:.{decimals}f}"
    if float(text) == 0:
        text = text.lstrip("-")
    return text.replace(".", ",")


def fmt_date(day: date) -> str:
    return day.strftime("%d.%m.%Y")


def plural_days(n: int) -> str:
    return f"{n} dzień" if n == 1 else f"{n} dni"


def plural_years(n: int) -> str:
    if n == 1:
        return "1 roku"
    return f"{n} lat"
