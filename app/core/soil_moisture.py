"""Wilgotność gleby w warstwach w okolicy działki na tle tych samych dni w poprzednich latach (bez sieci).

Wejście: dzienne serie wilgotności względnej (0–1) z modelu MERRA-2 udostępnianego przez NASA POWER
dla trzech warstw: powierzchnia, strefa korzeni, cały profil. Wartość to komórka siatki ok. 50 km,
więc opisuje okolicę, a nie działkę.

Porównanie jest takie samo jak dla rzeki (app.core.hydrology): średnia z 7 dni do daty analizy
wobec średnich z tych samych 7 dni kalendarzowych w poprzednich latach, ocena rangowa.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from app.core import hydrology as ranks

# (klucz, parametr NASA POWER, opis warstwy, góra [cm], dół [cm] lub None, gdy do skały macierzystej)
LAYERS = (
    ("surface", "GWETTOP", "wierzchnia warstwa", 0, 5),
    ("root_zone", "GWETROOT", "strefa korzeni", 0, 100),
    ("profile", "GWETPROF", "cały profil gleby", 0, None),
)

CLASS_LABELS = {
    "very_low": "znacznie sucho jak na tę porę roku",
    "low": "sucho jak na tę porę roku",
    "normal": "typowo dla tej pory roku",
    "high": "wilgotniej niż zwykle",
}


@dataclass
class LayerComparison:
    key: str
    label: str
    top_cm: int
    bottom_cm: int | None
    current_to: date
    comparison: ranks.Comparison


def compare_layers(series: dict[str, dict[date, float]], end: date, years_back: int) -> list[LayerComparison]:
    """Porównanie każdej warstwy. Okno kończy się w ostatnim dniu z danymi nie później niż `end`.

    Warstwa bez danych albo z mniej niż 5 latami odniesienia jest pomijana.
    """
    out = []
    for key, param, label, top, bottom in LAYERS:
        values = series.get(param) or {}
        days = [d for d in values if d <= end]
        if not days:
            continue
        current_to = max(days)
        current = ranks.window_mean(values, current_to)
        if current is None:
            continue
        cmp = ranks.compare(current, ranks.reference_values(values, current_to, years_back))
        if cmp is not None:
            out.append(LayerComparison(key, label, top, bottom, current_to, cmp))
    return out


def agreement_with_balance(layers: list[LayerComparison], balance_class: str | None) -> str | None:
    """Zdanie o zgodności strefy korzeni w okolicy z bilansem działki."""
    root = next((layer for layer in layers if layer.key == "root_zone"), None)
    if root is None or balance_class is None:
        return None
    dry_region = root.comparison.class_key in ("low", "very_low")
    dry_field = balance_class in ("moderate", "severe")
    if dry_region and dry_field:
        return "Model regionalny i bilans działki zgadzają się: w strefie korzeni brakuje wody."
    if dry_region:
        return ("W okolicy strefa korzeni jest suchsza niż zwykle, choć bilans działki nie pokazuje niedoboru. "
                "Przy kilku suchych tygodniach niedobór może pojawić się szybciej.")
    if dry_field:
        return ("Bilans działki pokazuje niedobór, a w okolicy wilgotność strefy korzeni jest typowa albo wyższa. "
                "Przyczyną może być gleba tej działki (mniejsza pojemność wodna) albo lokalnie mniejszy opad.")
    return "Model regionalny i bilans działki zgadzają się: brak oznak suszy w strefie korzeni."
