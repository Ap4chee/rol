"""Działania agrotechniczne: uprawa roli, dobór odmiany i terminu, zabiegi w czasie niedoboru, obserwacja pola."""
from __future__ import annotations

from app.core.recommendations.facts import (
    FREQUENT_STRESS_SEASONS,
    MIN_SEASONS_FOR_HISTORY,
    ROW_CROPS,
    SPRING_WATER_DAYS,
    WHOLE_FIELD,
    Facts,
    Rec,
    Result,
    is_stressed,
    is_vulnerable,
    soil_is_light,
    sowing_words,
    vulnerability_sentence,
)
from app.core.textfmt import fmt, plural_days


def reduced_tillage(f: Facts, out: Result) -> None:
    # Dla ziemniaka opis dotyczy formowania redlin bez sugerowania uprawy bezorkowej.
    if f.perennial or not (is_vulnerable(f) or soil_is_light(f)):
        return
    is_potato = f.crop_key == "potato"
    why = []
    if is_vulnerable(f):
        why.append(vulnerability_sentence(f))
    if soil_is_light(f):
        why.append(f"Gleba utrzymuje tylko {fmt(f.awc_mm_per_m)} mm wody dostępnej na metr głębokości.")
    why.append("Każdy dodatkowy przejazd i głębokie spulchnianie odsłania wilgotną glebę i przyspiesza jej wysychanie.")
    what = ("Zmniejsz liczbę przejazdów i uprawek przed sadzeniem; spulchniaj glebę tylko tak głęboko, jak wymaga "
            "sadzenie i formowanie redlin." if is_potato else
            "Zmniejsz liczbę przejazdów i głębokość uprawy przed siewem; rozważ uprawę uproszczoną (bez orki albo "
            "pasową), jeśli pozwala na to sprzęt i zachwaszczenie.")
    out.agrotechnical.append(Rec(
        "reduced_tillage", "agrotechnical", "Ogranicz intensywną uprawę roli", what, WHOLE_FIELD, " ".join(why), "średnia",
        "Nie wiemy, jak pole jest uprawiane teraz." if is_potato else
        "Nie wiemy, jak pole jest uprawiane teraz. Jeśli już stosujesz uprawę uproszczoną, pomiń tę pozycję."))


def crop_choice(f: Facts, out: Result) -> None:
    frequent = max(FREQUENT_STRESS_SEASONS, f.seasons_total // 2)
    if f.perennial or f.seasons_total < MIN_SEASONS_FOR_HISTORY or f.seasons_with_long_stress < frequent:
        return
    words = sowing_words(f)
    out.agrotechnical.append(Rec(
        "crop_choice", "agrotechnical", f"Dopasuj odmianę i termin {words.noun} do częstych niedoborów",
        f"Dla uprawy „{f.crop_name.lower()}” wybieraj odmiany wcześniejsze albo o większej tolerancji na suszę i {words.verb} w "
        "najwcześniejszym zalecanym terminie, żeby okres krytyczny przypadł, zanim zapas wody się wyczerpie.",
        WHOLE_FIELD,
        vulnerability_sentence(f) + (f" Mediana to {fmt(f.median_stress_days)} dni stresu w sezonie." if f.median_stress_days else ""),
        "średnia", "Wynik zakłada, że co roku rosła tu ta sama uprawa w umownych terminach."))


def limit_operations_now(f: Facts, out: Result) -> None:
    if not (f.in_season and is_stressed(f) and f.stage in ("initial", "development", "mid")):
        return
    if f.stage == "mid":
        # pełna okrywa: uprawki i nawożenie pogłówne są zwykle już za uprawą
        what = ("W tej fazie nie wykonuj już zabiegów uprawowych. Ogranicz przejazdy do niezbędnych, żeby nie ugniatać "
                "przesuszonej gleby i nie uszkadzać roślin.")
        fertilizer = ""
    else:
        what = ("Odłóż spulchnianie międzyrzędzi i inne uprawki, które odsłaniają wilgotną glebę. " if f.crop_key in ROW_CROPS
                else "Odłóż zabiegi, które odsłaniają albo ugniatają wilgotną glebę. ")
        what += "Pogłówne nawożenie azotem zaplanuj tuż przed zapowiadanym opadem."
        fertilizer = " Nawóz podany na suchą glebę nie zostanie pobrany."
    out.agrotechnical.append(Rec(
        "limit_operations_now", "agrotechnical", "Nie pogłębiaj niedoboru zabiegami", what, WHOLE_FIELD,
        f"W strefie korzeni brakuje {fmt(f.depletion_mm)} mm wody, o {fmt(f.depletion_mm - f.raw_mm)} mm ponad próg stresu "
        f"({fmt(f.raw_mm)} mm).{fertilizer}",
        "średnia" if not f.spans_classes else "niska",
        "Wniosek opiera się na bilansie z modelu pogody i mapy gleb" + (
            "; przedział niepewności gleby obejmuje więcej niż jedną klasę." if f.spans_classes else ".")))


def monitor_field(f: Facts, out: Result) -> None:
    if not (f.in_season and (f.class_key == "watch" or is_stressed(f) or f.spans_classes)):
        return
    if f.days_to_stress is not None and not is_stressed(f):
        why = (f"Do progu stresu zostaje {fmt(f.raw_mm - f.depletion_mm)} mm; przy zużyciu {fmt(f.etc_mm_day, 1)} mm na dobę "
               f"i bez opadu to ok. {plural_days(f.days_to_stress)}.")
    else:
        why = (f"Ubytek wody w strefie korzeni wynosi {fmt(f.depletion_mm)} mm przy progu stresu {fmt(f.raw_mm)} mm; "
               f"uprawa zużywa teraz ok. {fmt(f.etc_mm_day, 1)} mm na dobę.")
    out.agrotechnical.append(Rec(
        "monitor_field", "agrotechnical", "Oglądaj pole co kilka dni",
        "Sprawdzaj wilgotność gleby łopatą na głębokości 10–30 cm i wygląd roślin w południe (zwijanie, więdnięcie liści).",
        "Najpierw miejsca wyżej położone i najlżejsze fragmenty pola: tam niedobór widać najwcześniej.", why,
        "średnia", "Termin jest szacunkiem z bilansu; lokalny deszcz albo jego brak przesuwa go o kilka dni."))


def save_spring_water(f: Facts, out: Result) -> None:
    if f.in_season or f.stage != "off_season" or not is_stressed(f) or f.next_sowing_day is None:
        return
    days_left = (f.next_sowing_day - f.analysis_day).days
    if not 0 <= days_left <= SPRING_WATER_DAYS:
        return
    words = sowing_words(f)
    term = "podanym" if f.next_sowing_provided else "umownym"
    out.agrotechnical.append(Rec(
        "save_spring_water", "agrotechnical", f"Oszczędzaj wodę {words.before}",
        f"Ogranicz uprawki {words.before} do niezbędnego minimum i {words.verb} w najwcześniejszym możliwym terminie.",
        WHOLE_FIELD,
        f"Na {plural_days(days_left)} przed {term} terminem {words.noun} w glebie brakuje "
        f"{fmt(f.depletion_mm)} mm wody z {fmt(f.taw_mm)} mm możliwego zapasu.",
        "średnia", f"Stan zapasu pochodzi z bilansu; obliczenie uwzględnia {('podany' if f.next_sowing_provided else 'umowny')} termin {words.noun}."))
