"""Retencja glebowa i krajobrazowa: okrywa po zbiorze, materia organiczna, pas przy cieku, woda w rowach,
zapobiegawcze zatrzymanie wody. Ta grupa ma w raporcie pierwszeństwo."""
from __future__ import annotations

from dataclasses import dataclass

from app.core.recommendations.facts import (
    ALMOST_ALL_EVAPORATED,
    CATCH_CROP_LATEST_SOWING,
    CATCH_CROP_MIN_DAYS,
    HIGH_EVAPORATION_SHARE,
    LONG_BARE_PERIOD_DAYS,
    LOW_RIVER_CLASSES,
    LOW_SOC_G_KG,
    MIN_BARE_RAIN_MM,
    NEAR_WATERCOURSE_M,
    SOC_TO_HUMUS,
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
from app.core.textfmt import fmt, fmt_date, plural_days


@dataclass(frozen=True)
class _BareSoil:
    """Straty wody z odkrytej gleby w ostatnim okresie bez uprawy."""
    evaporation_share: float | None
    loses_water: bool
    sentence: str


def _bare_soil(f: Facts) -> _BareSoil:
    known = (f.bare_rain_mm is not None and f.bare_evaporation_mm is not None and f.bare_rain_mm >= MIN_BARE_RAIN_MM)
    if not known:
        return _BareSoil(None, False, "")
    share = f.bare_evaporation_mm / f.bare_rain_mm
    if share >= ALMOST_ALL_EVAPORATED:
        lost = "a według bilansu prawie wszystko odparowało z odkrytej gleby."
    else:
        lost = (f"z czego według bilansu {fmt(f.bare_evaporation_mm)} mm ({fmt(100 * share)}%) "
                "odparowało z odkrytej gleby.")
    sentence = (f" W ostatnim okresie bez uprawy ({fmt_date(f.bare_from)}–{fmt_date(f.bare_to)}) spadło "
                f"{fmt(f.bare_rain_mm)} mm deszczu, {lost}")
    return _BareSoil(share, share >= HIGH_EVAPORATION_SHARE, sentence)


def _cover_reasons(f: Facts, bare: _BareSoil) -> list[str]:
    dates_source = "terminy pola i kalendarz gatunku" if f.uses_field_dates else "kalendarz umowny"
    reasons = [f"Po zbiorze ({f.harvest_day.strftime('%d.%m')}) pole zostaje bez uprawy przez ok. "
               f"{plural_days(f.bare_period_days)}, do {sowing_words(f).noun} {f.next_sowing_day.strftime('%d.%m')} "
               f"({dates_source})."]
    if bare.sentence:
        reasons.append(bare.sentence.strip())
    if is_vulnerable(f):
        reasons.append(vulnerability_sentence(f))
    if soil_is_light(f):
        reasons.append(f"Gleba utrzymuje tylko {fmt(f.awc_mm_per_m)} mm wody dostępnej na metr głębokości.")
    return reasons


def _cover_confidence(f: Facts) -> tuple[str, str]:
    if f.satellite_green_cover is False and f.stage == "off_season":
        return "wysoka", "Zdjęcie satelitarne potwierdza, że pole jest teraz bez zielonej okrywy, a bilans pokazuje straty wody."
    return "średnia", ("Długość przerwy oszacowano na podstawie dostępnych terminów, a straty na parowanie z modelu bilansu; "
                       "nie wiemy, czy okrywa już jest stosowana.")


def _cover_present(bare: _BareSoil) -> Rec:
    return Rec(
        "cover_already_present", "field_check", "Okrywa po zbiorze: wygląda na to, że już jest",
        "Potwierdź, że zielona okrywa widoczna na zdjęciu satelitarnym to międzyplon albo samosiewy, i utrzymaj ją "
        "do późnej jesieni lub wiosny.", WHOLE_FIELD,
        "Najnowsze czyste zdjęcie pokazuje zieloną roślinność, choć według kalendarza wybranej uprawy pole powinno "
        "być puste. Okrywa ogranicza parowanie i spływ." + bare.sentence,
        "średnia", "Ze zdjęcia nie da się odróżnić międzyplonu od chwastów albo innej uprawy.")


def _residue_cover(f: Facts, bare: _BareSoil, late_harvest: bool) -> Rec:
    is_potato = f.crop_key == "potato"
    too_short = ("Na międzyplon po tym zbiorze jest już za późno." if late_harvest
                 else "Przerwa jest za krótka na międzyplon, ale wystarczy, żeby odkryta gleba traciła wodę.")
    residues = "rozdrobnione łęty i resztki po zbiorze" if is_potato else "rozdrobnione resztki (słomę, łęty, liście)"
    confidence, confidence_reason = _cover_confidence(f)
    return Rec(
        "residue_cover", "retention",
        "Zostaw resztki po zbiorze jako okrywę gleby" if is_potato else "Zostaw resztki pożniwne jako okrywę gleby",
        f"Po zbiorze zostaw {residues} na powierzchni aż do uprawy {sowing_words(f).before}, "
        "zamiast od razu je przyorywać. " + too_short,
        WHOLE_FIELD, " ".join(_cover_reasons(f, bare)), confidence, confidence_reason,
        {"bare_period_days": f.bare_period_days, "evaporation_share": bare.evaporation_share})


def _catch_crop(f: Facts, bare: _BareSoil) -> Rec:
    is_potato = f.crop_key == "potato"
    latest = f"{CATCH_CROP_LATEST_SOWING[1]:02d}.{CATCH_CROP_LATEST_SOWING[0]:02d}"
    what = (f"Po wykopkach wysiej międzyplon (np. gorczycę, facelię lub żyto), najlepiej do {latest}, "
            "i zostaw go jako okrywę do późnej jesieni albo jako mulcz do wiosny.") if is_potato else (
            f"Po zbiorze wysiej międzyplon ścierniskowy, najlepiej do {latest}, "
            "i zostaw go jako okrywę do późnej jesieni albo jako mulcz do wiosny.")
    if is_stressed(f) and f.stage == "off_season":
        what += (" Teraz gleba jest przesuszona: żywy międzyplon też zużywa wodę, więc przy braku opadu "
                 "lepiej zostawić same resztki po zbiorze.")
    confidence, confidence_reason = _cover_confidence(f)
    return Rec(
        "cover_crop", "retention",
        "Międzyplon albo okrywa po zbiorze" if is_potato else "Międzyplon albo resztki pożniwne po zbiorze",
        what, WHOLE_FIELD, " ".join(_cover_reasons(f, bare)), confidence, confidence_reason,
        {"bare_period_days": f.bare_period_days, "evaporation_share": bare.evaporation_share})


def cover_after_harvest(f: Facts, out: Result) -> None:
    """Okrywa gleby w przerwie między zbiorem a siewem: międzyplon, resztki albo potwierdzenie, że już jest."""
    has_bare_period = (not f.perennial and f.bare_period_days is not None
                       and f.bare_period_days >= LONG_BARE_PERIOD_DAYS and f.harvest_day is not None)
    bare = _bare_soil(f)
    if not has_bare_period or not (bare.loses_water or is_vulnerable(f) or soil_is_light(f)):
        return
    late_harvest = (f.harvest_day.month, f.harvest_day.day) > CATCH_CROP_LATEST_SOWING
    if f.satellite_green_cover is True and f.stage == "off_season":
        out.field_checks.append(_cover_present(bare))
    elif late_harvest or f.bare_period_days < CATCH_CROP_MIN_DAYS:
        out.retention.append(_residue_cover(f, bare, late_harvest))
    else:
        out.retention.append(_catch_crop(f, bare))


def organic_matter(f: Facts, out: Result) -> None:
    if f.soil_assumed or f.soc_0_30_g_kg is None:
        return
    if not ((soil_is_light(f) or f.soc_0_30_g_kg < LOW_SOC_G_KG) and (is_vulnerable(f) or soil_is_light(f))):
        return
    why = []
    if soil_is_light(f):
        why.append(f"Gleba ({f.topsoil_label or 'lekka'}) utrzymuje tylko {fmt(f.awc_mm_per_m)} mm wody dostępnej na metr głębokości.")
    why.append(f"Mapa SoilGrids podaje {fmt(f.soc_0_30_g_kg, 1)} g węgla organicznego na kg gleby w warstwie 0–30 cm "
               f"(ok. {fmt(f.soc_0_30_g_kg * SOC_TO_HUMUS, 1)}% próchnicy).")
    if is_vulnerable(f):
        why.append(vulnerability_sentence(f))
    why.append("Więcej próchnicy to większa pojemność wodna i lepsze wsiąkanie deszczu; efekt przychodzi po kilku latach.")
    out.retention.append(Rec(
        "organic_matter", "retention", "Zwiększaj zawartość materii organicznej",
        "Co roku zostawiaj na polu jak najwięcej biomasy: resztki pożniwne, międzyplony na przyoranie albo mulcz, "
        "obornik lub kompost, jeśli masz do nich dostęp.", WHOLE_FIELD, " ".join(why), "niska",
        "Zawartość węgla pochodzi z mapy globalnej 250 m, a nie z badania gleby na tym polu."))
    out.field_checks.append(Rec(
        "soil_lab_test", "field_check", "Zbadaj próchnicę i uziarnienie gleby",
        "Zleć badanie zawartości próchnicy i składu granulometrycznego w stacji chemiczno-rolniczej.",
        "Próbka z warstwy 0–30 cm z kilku miejsc pola, osobno z najsłabszego fragmentu.",
        "Od wyniku zależy, czy działanie „materia organiczna” jest tu priorytetem, i jak szeroki jest przedział niepewności bilansu.",
        "wysoka", "Badanie laboratoryjne rozstrzyga to, czego mapa 250 m nie pokazuje."))


def buffer_strip(f: Facts, out: Result) -> None:
    if f.watercourse_distance_m is None or f.watercourse_distance_m > NEAR_WATERCOURSE_M:
        return
    name = f" ({f.watercourse_name})" if f.watercourse_name else ""
    out.retention.append(Rec(
        "buffer_strip_watercourse", "retention", "Pas trwałej roślinności wzdłuż cieku",
        "Utrzymaj albo załóż pas trawy, krzewów lub drzew między uprawą a ciekiem i nie uprawiaj gleby do samego brzegu.",
        f"Granica działki od strony cieku{name}.",
        (f"Ciek{name} przecina działkę albo biegnie jej granicą (mapa hydrograficzna MPHP10k). "
         if f.watercourse_distance_m == 0 else
         f"Ciek{name} przebiega ok. {fmt(f.watercourse_distance_m)} m od granicy działki (mapa hydrograficzna MPHP10k). ")
        + "Pas roślinności zatrzymuje spływającą wodę i glebę, zanim trafią do cieku.",
        "średnia", "Odległość odczytano z mapy w skali 1:10 000; szerokość pasa trzeba dobrać na miejscu."))


def hold_water_in_ditches(f: Facts, out: Result) -> None:
    if f.river_class not in LOW_RIVER_CLASSES or not f.river_evidence:
        return
    soil_state = ("W glebie działki też brakuje wody." if is_stressed(f)
                  else "Zapas wody zatrzymany teraz w okolicy pola zmniejsza ryzyko niedoboru w kolejnych tygodniach.")
    out.retention.append(Rec(
        "hold_water_in_ditches", "retention", "Zatrzymaj wodę w rowach zamiast ją odprowadzać",
        "Jeśli przy polu są rowy melioracyjne albo drenowanie, zamknij lub podnieś zastawki (albo poproś o to spółkę "
        "wodną), żeby woda nie odpływała z okolicy pola. Nie pogłębiaj i nie udrażniaj rowów odwadniających w czasie suszy.",
        "Rowy i wyloty drenów przy działce, jeśli są (raport nie ma mapy rowów).",
        f"{f.river_evidence} {soil_state}",
        "niska", "Stan rzeki pochodzi z najbliższego wodowskazu i opisuje całą zlewnię; nie wiemy, czy przy tym polu są "
        "rowy z zastawkami."))


def preventive_retention(f: Facts, out: Result) -> None:
    """Retencja ma pierwszeństwo zawsze (zadanie KOWR, „zatrzymaj wodę tam, gdzie spadła”): gdy żadna reguła wyżej
    nie zadziałała, raport podaje działanie zapobiegawcze z liczbami tej działki zamiast pustej listy."""
    if out.retention:
        return
    why = [f"Według bilansu w strefie korzeni brakuje teraz {fmt(f.depletion_mm)} mm wody z {fmt(f.taw_mm)} mm, "
           f"które ta gleba może utrzymać, więc zapas jest wystarczający."]
    if f.seasons_total:
        why.append(vulnerability_sentence(f))
    why.append("Woda zatrzymana w glebie w okresie z wystarczającym zapasem zmniejsza ryzyko niedoboru w okresie suchym.")
    what = ("Nie zostawiaj gleby odkrytej: po zbiorze zostaw resztki pożniwne albo wysiej międzyplon. "
            "Ogranicz uprawki, które odsłaniają wilgotną glebę.") if not f.perennial else (
            "Utrzymuj zwartą darń i nie przesuszaj jej zbyt niskim koszeniem w okresach bez opadu.")
    out.retention.append(Rec(
        "keep_water_preventive", "retention", "Zatrzymuj wodę w glebie zapobiegawczo", what, WHOLE_FIELD,
        " ".join(why), "średnia",
        "Działanie zapobiegawcze: bilans nie pokazuje teraz niedoboru, a historia działki nie wskazuje częstych susz."))
