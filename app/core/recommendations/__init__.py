"""Reguły rekomendacji. Każda reguła to warunek na policzonych wartościach tej działki, kategoria i tekst
z wstawionymi wartościami, w układzie: co zrobić, gdzie, dlaczego, jak pewny jest wniosek.

Kolejność narzucona przez zadanie KOWR: retencja → agrotechnika → nawadnianie (na końcu i tylko wtedy,
gdy niedobór pozostaje). Lista działań pochodzi z materiałów KOWR („Podstawy naukowe”, tabela 12 działań
w docs/podsumowanie_retencja.md): retencja glebowa (międzyplony, resztki pożniwne, materia organiczna)
i krajobrazowa (strefy buforowe, zbiorniki, oczka, mokradła, zadrzewienia, spowalnianie odpływu), działania
agrotechniczne (ograniczenie intensywnej uprawy, dobór uprawy i terminów, monitorowanie), nawadnianie opcjonalne.
Reguły zależne od ukształtowania terenu są w app/core/terrain_rules.py, bo teren liczy się osobno.

Gdy brakuje informacji rozstrzygającej, reguła nie daje rekomendacji, tylko wskazuje, co sprawdzić na polu.
Progi są jawne (stałe poniżej) i są założeniami roboczymi, nie wartościami z publikacji.
"""
from __future__ import annotations

from app.core.recommendations.agrotechnical import (
    crop_choice,
    limit_operations_now,
    monitor_field,
    reduced_tillage,
    save_spring_water,
)
from app.core.recommendations.facts import AFTER_HARVEST_KEYS, NOW_KEYS, Facts, Rec, Result
from app.core.recommendations.irrigation import field_checks, irrigation
from app.core.recommendations.retention import (
    buffer_strip,
    cover_after_harvest,
    hold_water_in_ditches,
    organic_matter,
    preventive_retention,
)

__all__ = ["Facts", "Rec", "Result", "build"]


def _set_timing(f: Facts, out: Result) -> None:
    for rec in [*out.retention, *out.agrotechnical, *out.irrigation, *out.field_checks]:
        if rec.key in NOW_KEYS:
            rec.timing = "now"
        elif rec.key in AFTER_HARVEST_KEYS:
            # po zbiorze, a poza sezonem (pole już po zbiorze) to sprawa bieżąca
            rec.timing = "now" if f.stage == "off_season" else "after_harvest"


# Kolejność narzucona przez zadanie: retencja glebowa i krajobrazowa, agrotechnika, nawadnianie, oględziny.
# Reguła zapobiegawcza musi być ostatnią z retencyjnych, bo działa tylko przy pustej liście.
RULES = (cover_after_harvest, organic_matter, buffer_strip, hold_water_in_ditches, preventive_retention,
         reduced_tillage, crop_choice, limit_operations_now, monitor_field, save_spring_water,
         irrigation, field_checks)


def build(f: Facts) -> Result:
    out = Result()
    for rule in RULES:
        rule(f, out)
    _set_timing(f, out)
    return out
