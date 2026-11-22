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


def signed(value: float) -> str:
    """Liczba ze znakiem i polskim przecinkiem, 2 miejsca (dokładność NDMI)."""
    text = fmt(value, 2)
    return text if text.startswith("-") or text == "0,00" else "+" + text


def count_noun(n: int, one: str, few: str, many: str) -> str:
    """„1 dawka”, „3 dawki”, „5 dawek”: polska odmiana po liczebniku."""
    return f"{n} {one if n == 1 else few if n % 10 in (2, 3, 4) and n % 100 not in (12, 13, 14) else many}"
