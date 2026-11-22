"""Nawadnianie (na końcu i tylko przy niedoborze w fazie, w której obniża plon) oraz to, co sprawdzić na polu."""
from __future__ import annotations

from math import ceil

from app.core.recommendations.facts import (
    LOW_RIVER_CLASSES,
    SINGLE_DOSE_MM,
    Facts,
    Rec,
    Result,
    is_stressed,
)
from app.presentation.textfmt import fmt


def _dose_guidance(depletion_mm: float) -> str:
    low, high = SINGLE_DOSE_MM
    if depletion_mm <= high:
        return (f"Wystarczy jedna dawka do {fmt(depletion_mm)} mm (nie więcej niż ubytek, "
                "żeby nadmiar nie przesiąkł poniżej korzeni).")
    doses = ceil(depletion_mm / ((low + high) / 2))
    dose_word = "dawki" if doses % 10 in (2, 3, 4) and doses % 100 not in (12, 13, 14) else "dawek"
    return (f"Podziel to na dawki po {low}–{high} mm (ok. {doses} {dose_word} po 25 mm, z ostatnią mniejszą), żeby woda zdążyła wsiąknąć "
            f"i nie spłynęła; łącznie nie przekraczaj ubytku ({fmt(depletion_mm)} mm), bo nadmiar przesiąknie poniżej korzeni.")


def irrigation(f: Facts, out: Result) -> None:
    """Nawadnianie na końcu i tylko wtedy, gdy niedobór pozostaje w fazie, w której obniża plon."""
    if not f.in_season:
        out.irrigation_note = "Uprawa nie jest teraz w okresie wzrostu, więc nawadnianie nie jest uzasadnione."
        return
    if not is_stressed(f):
        out.irrigation_note = ("Bilans nie pokazuje niedoboru wody: nawadnianie nie jest teraz potrzebne. "
                               "Pierwszeństwo mają działania zatrzymujące wodę w glebie.")
        return
    if f.stage == "late":
        out.irrigation_note = ("Uprawa dojrzewa: mimo niedoboru nawadnianie na tym etapie zwykle nie poprawia już plonu, "
                               "więc go nie rekomendujemy.")
        return
    to_threshold = max(f.depletion_mm - f.raw_mm, 0.0)
    thresholds = [max(d - r, 0.0) for d, r in f.variants]
    refills = [d for d, _ in f.variants]
    out.irrigation.append(Rec(
        "irrigation_optional", "irrigation", "Nawodnienie, jeśli masz dostęp do wody i instalację",
        f"Rozważ nawodnienie w najbliższych dniach. Do progu bez stresu brakuje ok. {fmt(to_threshold)} mm netto, a do pełnego "
        f"zapasu {fmt(f.depletion_mm)} mm (1 mm = 10 m³ na hektar). {_dose_guidance(f.depletion_mm)} "
        "Przed spodziewanym deszczem odłóż zabieg.",
        "Najpierw fragmenty pola o najlżejszej glebie.",
        f"Niedobór pozostaje mimo działań retencyjnych, które działają w dłuższym czasie: ubytek {fmt(f.depletion_mm)} mm "
        f"przekracza próg stresu ({fmt(f.raw_mm)} mm), a uprawa jest w fazie, w której brak wody obniża plon.",
        "niska" if f.spans_classes or f.soil_assumed else "średnia",
        f"Dawka wynika z bilansu. Dla granic niepewności gleby do progu brakuje od {fmt(min(thresholds))} do "
        f"{fmt(max(thresholds))} mm, a do pełnego zapasu od {fmt(min(refills))} do {fmt(max(refills))} mm. "
        "Nie znamy wydajności instalacji ani wcześniejszych nawodnień.",
        {"to_threshold_mm": round(to_threshold), "full_refill_mm": round(f.depletion_mm)}))
    out.irrigation_note = ("Pobór wody do nawodnień może wymagać zgłoszenia albo pozwolenia wodnoprawnego. "
                           "Nawadnianie jest uzupełnieniem, a nie zamiennikiem działań retencyjnych.")
    if f.river_class in LOW_RIVER_CLASSES:
        out.irrigation_note += (" Rzeki w okolicy niosą teraz mało wody, więc pobór z cieku lub rowu może być ograniczony "
                                "i odbiera wodę innym użytkownikom.")


def field_checks(f: Facts, out: Result) -> None:
    """Co sprawdzić na polu tam, gdzie dane nie rozstrzygają."""
    if f.soil_assumed or f.spans_classes:
        reason = ("Nie udało się pobrać danych o glebie, więc bilans policzono dla gleby umownej."
                  if f.soil_assumed else
                  f"Dla granic niepewności gleby ubytek wody wynosi od {fmt(min(d for d, _ in f.variants))} do "
                  f"{fmt(max(d for d, _ in f.variants))} mm i wynik wypada w różnych klasach.")
        out.field_checks.append(Rec(
            "check_soil_texture", "field_check", "Sprawdź, jaką masz glebę",
            "Wykop dołek na 50 cm i oceń glebę w dłoni: piasek się sypie, glina daje się uformować w wałeczek. "
            "Jeśli masz mapę glebowo-rolniczą albo wyniki badań, porównaj je z profilem w raporcie.",
            "Środek pola i miejsce, gdzie rośliny zwykle najszybciej więdną.", reason, "wysoka",
            "Od rodzaju gleby zależy, ile wody mieści strefa korzeni, a więc i klasa niedoboru."))
    if f.satellite_field_check:
        out.field_checks.append(Rec(
            "satellite_divergence", "field_check", "Obejrzyj pole: zdjęcia satelitarne nie zgadzają się z bilansem",
            "Sprawdź wilgotność gleby na 10–30 cm i stan roślin, a także to, czy pole było nawadniane albo czy woda "
            "gruntowa jest płytko.", "Kilka miejsc na polu, w tym obniżenia i wzniesienia.",
            "Bilans i wskaźniki z Sentinel-2 dają różny obraz, a dane nie rozstrzygają, który jest trafny.",
            "wysoka", "Oględziny rozstrzygają rozbieżność, której nie da się wyjaśnić z danych."))
