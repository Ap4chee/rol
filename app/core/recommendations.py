"""Reguły rekomendacji. Każda reguła to warunek na policzonych wartościach tej działki, kategoria i tekst
z wstawionymi wartościami, w układzie: co zrobić, gdzie, dlaczego, jak pewny jest wniosek.

Kolejność narzucona przez zadanie KOWR: retencja → agrotechnika → nawadnianie (na końcu i tylko wtedy,
gdy niedobór pozostaje). Lista działań pochodzi z materiałów KOWR („Podstawy naukowe”, tabela 12 działań
w outputs/podsumowanie_kowr_retencja.md): retencja glebowa (międzyplony, resztki pożniwne, materia organiczna)
i krajobrazowa (strefy buforowe, zbiorniki, oczka, mokradła, zadrzewienia, spowalnianie odpływu), działania
agrotechniczne (ograniczenie intensywnej uprawy, dobór uprawy i terminów, monitorowanie), nawadnianie opcjonalne.
Reguły zależne od ukształtowania terenu są w app/core/terrain_rules.py, bo teren liczy się osobno.

Gdy brakuje informacji rozstrzygającej, reguła nie daje rekomendacji, tylko wskazuje, co sprawdzić na polu.
Progi są jawne (stałe poniżej) i są założeniami roboczymi, nie wartościami z publikacji.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date

from app.textfmt import fmt, fmt_date, plural_days

# --- progi reguł (założenia robocze) ---
LONG_BARE_PERIOD_DAYS = 45          # dłuższa przerwa bez uprawy uzasadnia okrywę gleby
CATCH_CROP_MIN_DAYS = 75            # międzyplon ma sens, gdy przerwa trwa co najmniej tyle; krótszą okrywają resztki
CATCH_CROP_LATEST_SOWING = (9, 20)  # po tym dniu (miesiąc, dzień) międzyplon ścierniskowy zwykle nie zdąży urosnąć
LOW_AWC_MM_PER_M = 100.0            # gleba o małej pojemności wodnej
LOW_SOC_G_KG = 12.0                 # ok. 2% próchnicy w warstwie 0–30 cm
FREQUENT_STRESS_SEASONS = 3         # w tylu z 10 sezonów długi stres = pole podatne
HIGH_EVAPORATION_SHARE = 0.5        # ponad połowa opadu z okresu bez uprawy odparowała z odkrytej gleby
MIN_BARE_RAIN_MM = 40.0             # ...i dotyczy to okresu z opadem co najmniej tej wielkości


@dataclass
class Facts:
    """Policzone wartości działki, na których działają reguły."""
    crop_key: str
    crop_name: str
    perennial: bool
    analysis_day: date
    in_season: bool
    stage: str                       # initial | development | mid | late | dormant | off_season
    class_key: str                   # none | watch | moderate | severe
    depletion_mm: float
    raw_mm: float
    taw_mm: float
    variants: list[tuple[float, float]]      # (ubytek, próg RAW) w mm dla każdego wariantu gleby
    spans_classes: bool
    soil_assumed: bool
    awc_mm_per_m: float
    topsoil_label: str | None
    soc_0_30_g_kg: float | None
    seasons_total: int
    seasons_with_stress: int
    seasons_with_long_stress: int
    median_stress_days: float | None
    days_to_stress: int | None               # ile dni bez opadu do progu stresu przy obecnym zużyciu
    etc_mm_day: float
    harvest_day: date | None                 # zbiór sezonu, który trwa albo właśnie minął (kalendarz umowny)
    next_sowing_day: date | None
    bare_period_days: int | None             # przerwa między zbiorem a kolejnym siewem
    bare_rain_mm: float | None               # opad w ostatnim okresie bez uprawy
    bare_evaporation_mm: float | None        # parowanie z odkrytej gleby w tym okresie (z bilansu)
    bare_from: date | None = None
    bare_to: date | None = None
    satellite_green_cover: bool | None = None   # co pokazuje najnowsze czyste zdjęcie (None = brak zdjęcia)
    satellite_agreement: str | None = None      # confirms | diverges | inconclusive
    satellite_field_check: bool = False
    watercourse_distance_m: float | None = None
    watercourse_name: str | None = None


@dataclass
class Rec:
    key: str
    category: str      # retention | agrotechnical | irrigation | field_check
    title: str
    what: str
    where: str
    why: str
    confidence: str    # wysoka | średnia | niska
    confidence_reason: str
    evidence: dict = field(default_factory=dict)


@dataclass
class Result:
    retention: list[Rec] = field(default_factory=list)
    agrotechnical: list[Rec] = field(default_factory=list)
    irrigation: list[Rec] = field(default_factory=list)
    field_checks: list[Rec] = field(default_factory=list)
    irrigation_note: str | None = None


def _vulnerability_sentence(f: Facts) -> str:
    return (f"W {f.seasons_with_long_stress} z {f.seasons_total} ostatnich sezonów bilans pokazał w okresie krytycznym "
            f"dla plonu stres wodny trwający co najmniej 14 dni.")


def _is_vulnerable(f: Facts) -> bool:
    return f.seasons_total >= 5 and f.seasons_with_long_stress >= FREQUENT_STRESS_SEASONS


def _soil_is_light(f: Facts) -> bool:
    return not f.soil_assumed and f.awc_mm_per_m < LOW_AWC_MM_PER_M


def build(f: Facts) -> Result:
    out = Result()
    stressed = f.class_key in ("moderate", "severe")
    whole_field = "Cała działka."

    # ---------- RETENCJA GLEBOWA ----------
    has_bare_period = (not f.perennial and f.bare_period_days is not None
                       and f.bare_period_days >= LONG_BARE_PERIOD_DAYS and f.harvest_day is not None)
    evaporation_known = (f.bare_rain_mm is not None and f.bare_evaporation_mm is not None
                         and f.bare_rain_mm >= MIN_BARE_RAIN_MM)
    evaporation_share = f.bare_evaporation_mm / f.bare_rain_mm if evaporation_known else None
    loses_water_when_bare = evaporation_share is not None and evaporation_share >= HIGH_EVAPORATION_SHARE
    bare_sentence = ""
    if evaporation_known:
        if evaporation_share >= 0.95:
            lost = "a według bilansu prawie wszystko odparowało z odkrytej gleby."
        else:
            lost = (f"z czego według bilansu {fmt(f.bare_evaporation_mm)} mm ({fmt(100 * evaporation_share)}%) "
                    "odparowało z odkrytej gleby.")
        bare_sentence = (f" W ostatnim okresie bez uprawy ({fmt_date(f.bare_from)}–{fmt_date(f.bare_to)}) spadło "
                         f"{fmt(f.bare_rain_mm)} mm deszczu, {lost}")

    if has_bare_period and (loses_water_when_bare or _is_vulnerable(f) or _soil_is_light(f)):
        harvest = f.harvest_day
        late_harvest = (harvest.month, harvest.day) > CATCH_CROP_LATEST_SOWING
        reasons = [f"Po zbiorze ({harvest.strftime('%d.%m')}) pole zostaje bez uprawy przez ok. {plural_days(f.bare_period_days)}, "
                   f"do siewu {f.next_sowing_day.strftime('%d.%m')} (kalendarz umowny)."]
        if bare_sentence:
            reasons.append(bare_sentence.strip())
        if _is_vulnerable(f):
            reasons.append(_vulnerability_sentence(f))
        if _soil_is_light(f):
            reasons.append(f"Gleba utrzymuje tylko {fmt(f.awc_mm_per_m)} mm wody dostępnej na metr głębokości.")
        cover_seen = f.satellite_green_cover is True and f.stage == "off_season"
        confidence = "średnia"
        confidence_reason = ("Długość przerwy wynika z umownego kalendarza uprawy, a straty na parowanie z modelu bilansu; "
                             "nie wiemy, czy okrywa już jest stosowana.")
        if f.satellite_green_cover is False and f.stage == "off_season":
            confidence = "wysoka"
            confidence_reason = "Zdjęcie satelitarne potwierdza, że pole jest teraz bez zielonej okrywy, a bilans pokazuje straty wody."
        if cover_seen:
            out.field_checks.append(Rec(
                "cover_already_present", "field_check", "Okrywa po zbiorze: wygląda na to, że już jest",
                "Potwierdź, że zielona okrywa widoczna na zdjęciu satelitarnym to międzyplon albo samosiewy, i utrzymaj ją "
                "do późnej jesieni lub wiosny.", whole_field,
                "Najnowsze czyste zdjęcie pokazuje zieloną roślinność, choć według kalendarza wybranej uprawy pole powinno "
                "być puste. Okrywa ogranicza parowanie i spływ." + bare_sentence,
                "średnia", "Ze zdjęcia nie da się odróżnić międzyplonu od chwastów albo innej uprawy."))
        elif late_harvest or f.bare_period_days < CATCH_CROP_MIN_DAYS:
            too_short = ("Na międzyplon ścierniskowy jest po tym zbiorze za późno." if late_harvest
                         else "Przerwa jest za krótka na międzyplon, ale wystarczy, żeby odkryta gleba traciła wodę.")
            out.retention.append(Rec(
                "residue_cover", "retention", "Zostaw resztki pożniwne jako okrywę gleby",
                "Po zbiorze zostaw rozdrobnione resztki (słomę, łęty, liście) na powierzchni aż do uprawy przedsiewnej, "
                "zamiast od razu je przyorywać. " + too_short,
                whole_field, " ".join(reasons), confidence, confidence_reason,
                {"bare_period_days": f.bare_period_days, "evaporation_share": evaporation_share}))
        else:
            dry_now = stressed and f.stage == "off_season"
            latest = f"{CATCH_CROP_LATEST_SOWING[1]:02d}.{CATCH_CROP_LATEST_SOWING[0]:02d}"
            what = (f"Po zbiorze wysiej międzyplon ścierniskowy, najlepiej do {latest}, "
                    "i zostaw go jako okrywę do późnej jesieni albo jako mulcz do wiosny.")
            if dry_now:
                what += (" Teraz gleba jest przesuszona: żywy międzyplon też zużywa wodę, więc przy braku opadu "
                         "lepiej zostawić same resztki pożniwne.")
            out.retention.append(Rec(
                "cover_crop", "retention", "Międzyplon albo resztki pożniwne po zbiorze", what, whole_field,
                " ".join(reasons), confidence, confidence_reason,
                {"bare_period_days": f.bare_period_days, "evaporation_share": evaporation_share}))

    if not f.soil_assumed and f.soc_0_30_g_kg is not None and (_soil_is_light(f) or f.soc_0_30_g_kg < LOW_SOC_G_KG) \
            and (_is_vulnerable(f) or _soil_is_light(f)):
        why = []
        if _soil_is_light(f):
            why.append(f"Gleba ({f.topsoil_label or 'lekka'}) utrzymuje tylko {fmt(f.awc_mm_per_m)} mm wody dostępnej na metr głębokości.")
        why.append(f"Mapa SoilGrids podaje {fmt(f.soc_0_30_g_kg, 1)} g węgla organicznego na kg gleby w warstwie 0–30 cm "
                   f"(ok. {fmt(f.soc_0_30_g_kg * 0.1724, 1)}% próchnicy).")
        if _is_vulnerable(f):
            why.append(_vulnerability_sentence(f))
        why.append("Więcej próchnicy to większa pojemność wodna i lepsze wsiąkanie deszczu; efekt przychodzi po kilku latach.")
        out.retention.append(Rec(
            "organic_matter", "retention", "Zwiększaj zawartość materii organicznej",
            "Co roku zostawiaj na polu jak najwięcej biomasy: resztki pożniwne, międzyplony na przyoranie albo mulcz, "
            "obornik lub kompost, jeśli masz do nich dostęp.", whole_field, " ".join(why), "niska",
            "Zawartość węgla pochodzi z mapy globalnej 250 m, a nie z badania gleby na tym polu."))
        out.field_checks.append(Rec(
            "soil_lab_test", "field_check", "Zbadaj próchnicę i uziarnienie gleby",
            "Zleć badanie zawartości próchnicy i składu granulometrycznego w stacji chemiczno-rolniczej.",
            "Próbka z warstwy 0–30 cm z kilku miejsc pola, osobno z najsłabszego fragmentu.",
            "Od wyniku zależy, czy działanie „materia organiczna” jest tu priorytetem, i jak szeroki jest przedział niepewności bilansu.",
            "wysoka", "Badanie laboratoryjne rozstrzyga to, czego mapa 250 m nie pokazuje."))

    if f.watercourse_distance_m is not None and f.watercourse_distance_m <= 20.0:
        name = f" ({f.watercourse_name})" if f.watercourse_name else ""
        out.retention.append(Rec(
            "buffer_strip_watercourse", "retention", "Pas trwałej roślinności wzdłuż cieku",
            "Utrzymaj albo załóż pas trawy, krzewów lub drzew między uprawą a ciekiem i nie uprawiaj gleby do samego brzegu.",
            f"Granica działki od strony cieku{name}.",
            f"Ciek{name} przebiega ok. {fmt(f.watercourse_distance_m)} m od granicy działki (mapa hydrograficzna MPHP10k). "
            "Pas roślinności zatrzymuje spływającą wodę i glebę, zanim trafią do cieku.",
            "średnia", "Odległość odczytano z mapy w skali 1:10 000; szerokość pasa trzeba dobrać na miejscu."))

    # ---------- AGROTECHNIKA ----------
    if not f.perennial and (_is_vulnerable(f) or _soil_is_light(f)):
        why = []
        if _is_vulnerable(f):
            why.append(_vulnerability_sentence(f))
        if _soil_is_light(f):
            why.append(f"Gleba utrzymuje tylko {fmt(f.awc_mm_per_m)} mm wody dostępnej na metr głębokości.")
        why.append("Każdy dodatkowy przejazd i głębokie spulchnianie odsłania wilgotną glebę i przyspiesza jej wysychanie.")
        out.agrotechnical.append(Rec(
            "reduced_tillage", "agrotechnical", "Ogranicz intensywną uprawę roli",
            "Zmniejsz liczbę przejazdów i głębokość uprawy przed siewem; rozważ uprawę uproszczoną (bez orki albo pasową), "
            "jeśli pozwala na to sprzęt i zachwaszczenie.", whole_field, " ".join(why), "średnia",
            "Nie wiemy, jak pole jest uprawiane teraz. Jeśli już stosujesz uprawę uproszczoną, pomiń tę pozycję."))

    if not f.perennial and f.seasons_total >= 5 and f.seasons_with_long_stress >= max(FREQUENT_STRESS_SEASONS, f.seasons_total // 2):
        out.agrotechnical.append(Rec(
            "crop_choice", "agrotechnical", "Dopasuj odmianę i termin siewu do częstych niedoborów",
            f"Dla uprawy „{f.crop_name.lower()}” wybieraj odmiany wcześniejsze albo o większej tolerancji na suszę i siej w "
            "najwcześniejszym zalecanym terminie, żeby okres krytyczny przypadł, zanim zapas wody się wyczerpie.",
            whole_field,
            _vulnerability_sentence(f) + (f" Mediana to {fmt(f.median_stress_days)} dni stresu w sezonie." if f.median_stress_days else ""),
            "średnia", "Wynik zakłada, że co roku rosła tu ta sama uprawa w umownych terminach."))

    if f.in_season and stressed and f.stage in ("initial", "development", "mid"):
        out.agrotechnical.append(Rec(
            "limit_operations_now", "agrotechnical", "Nie pogłębiaj niedoboru zabiegami",
            "Odłóż uprawki i spulchnianie międzyrzędzi, które odsłaniają wilgotną glebę. Pogłówne nawożenie azotem zaplanuj "
            "tuż przed zapowiadanym opadem.", whole_field,
            f"W strefie korzeni brakuje {fmt(f.depletion_mm)} mm wody, o {fmt(f.depletion_mm - f.raw_mm)} mm ponad próg stresu "
            f"({fmt(f.raw_mm)} mm). Nawóz podany na suchą glebę nie zostanie pobrany.",
            "średnia" if not f.spans_classes else "niska",
            "Wniosek opiera się na bilansie z modelu pogody i mapy gleb" + (
                "; przedział niepewności gleby obejmuje więcej niż jedną klasę." if f.spans_classes else ".")))

    if f.in_season and (f.class_key == "watch" or stressed or f.spans_classes):
        if f.days_to_stress is not None and not stressed:
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

    if not f.in_season and f.stage == "off_season" and stressed and f.next_sowing_day is not None \
            and 0 <= (f.next_sowing_day - f.analysis_day).days <= 75:
        out.agrotechnical.append(Rec(
            "save_spring_water", "agrotechnical", "Oszczędzaj wodę przed siewem",
            "Ogranicz przedsiewne uprawki do niezbędnego minimum i siej w najwcześniejszym możliwym terminie.", whole_field,
            f"Na {plural_days((f.next_sowing_day - f.analysis_day).days)} przed umownym terminem siewu w glebie brakuje "
            f"{fmt(f.depletion_mm)} mm wody z {fmt(f.taw_mm)} mm możliwego zapasu.",
            "średnia", "Stan zapasu pochodzi z bilansu; termin siewu jest umowny."))

    # ---------- NAWADNIANIE (opcjonalne, na końcu) ----------
    if not f.in_season:
        out.irrigation_note = "Uprawa nie jest teraz w okresie wzrostu, więc nawadnianie nie jest uzasadnione."
    elif not stressed:
        out.irrigation_note = ("Bilans nie pokazuje niedoboru wody: nawadnianie nie jest teraz potrzebne. "
                               "Pierwszeństwo mają działania zatrzymujące wodę w glebie.")
    elif f.stage == "late":
        out.irrigation_note = ("Uprawa dojrzewa: mimo niedoboru nawadnianie na tym etapie zwykle nie poprawia już plonu, "
                               "więc go nie rekomendujemy.")
    else:
        to_threshold = max(f.depletion_mm - f.raw_mm, 0.0)
        thresholds = [max(d - r, 0.0) for d, r in f.variants]
        refills = [d for d, _ in f.variants]
        out.irrigation.append(Rec(
            "irrigation_optional", "irrigation", "Nawodnienie, jeśli masz dostęp do wody i instalację",
            f"Rozważ nawodnienie w najbliższych dniach. Do progu bez stresu brakuje ok. {fmt(to_threshold)} mm netto, a do pełnego "
            f"zapasu {fmt(f.depletion_mm)} mm (1 mm = 10 m³ na hektar). Jednorazowo nie podawaj więcej niż {fmt(f.depletion_mm)} mm: "
            "nadmiar przesiąknie poniżej korzeni. Dawkę podziel na mniejsze, żeby woda nie spłynęła, a przed spodziewanym "
            "deszczem odłóż zabieg.",
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

    # ---------- CO SPRAWDZIĆ NA POLU ----------
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
    return out
