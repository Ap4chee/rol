"""Fakty działki, na których działają reguły, i wspólne progi. Progi są założeniami roboczymi."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date

LONG_BARE_PERIOD_DAYS = 45          # dłuższa przerwa bez uprawy uzasadnia okrywę gleby
CATCH_CROP_MIN_DAYS = 75            # międzyplon ma sens, gdy przerwa trwa co najmniej tyle; krótszą okrywają resztki
CATCH_CROP_LATEST_SOWING = (9, 20)  # po tym dniu (miesiąc, dzień) międzyplon ścierniskowy zwykle nie zdąży urosnąć
LOW_AWC_MM_PER_M = 100.0            # gleba o małej pojemności wodnej
LOW_SOC_G_KG = 12.0                 # ok. 2% próchnicy w warstwie 0–30 cm
FREQUENT_STRESS_SEASONS = 3         # w tylu z 10 sezonów długi stres = pole podatne
HIGH_EVAPORATION_SHARE = 0.5        # ponad połowa opadu z okresu bez uprawy odparowała z odkrytej gleby
MIN_BARE_RAIN_MM = 40.0             # ...i dotyczy to okresu z opadem co najmniej tej wielkości
SINGLE_DOSE_MM = (20, 30)           # zwykła jednorazowa dawka deszczowania; większa spływa albo przesiąka poniżej korzeni
ROW_CROPS = ("maize", "potato", "sugar_beet")   # uprawy w szerokich rzędach (spulchnianie międzyrzędzi)
WHOLE_FIELD = "Cała działka."
DEFICIT_CLASSES = ("moderate", "severe")
LOW_RIVER_CLASSES = ("low", "very_low")
NEAR_WATERCOURSE_M = 20.0           # ciek tak blisko granicy, że pas roślinności ma sens na samej działce
ALMOST_ALL_EVAPORATED = 0.95
SOC_TO_HUMUS = 0.1724               # współczynnik van Bemmelena: próchnica ≈ 1,724 × węgiel organiczny
MIN_SEASONS_FOR_HISTORY = 5
SPRING_WATER_DAYS = 75              # tyle dni przed siewem warto już oszczędzać wodę w glebie


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
    uses_field_dates: bool = False
    next_sowing_provided: bool = False
    satellite_green_cover: bool | None = None   # co pokazuje najnowsze czyste zdjęcie (None = brak zdjęcia)
    satellite_agreement: str | None = None      # confirms | diverges | inconclusive
    satellite_field_check: bool = False
    watercourse_distance_m: float | None = None
    watercourse_name: str | None = None
    river_class: str | None = None              # very_low | low | normal | high (najbliższy wodowskaz IMGW)
    river_evidence: str | None = None           # zdanie z danymi wodowskazu do uzasadnienia


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
    timing: str = "long_term"   # now | after_harvest | long_term (kiedy działanie wykonać; ustawia build)


# Działania na najbliższe dni; okrywa po zbiorze zależy od fazy, reszta to plan na kolejne sezony.
NOW_KEYS = {"cover_already_present", "hold_water_in_ditches", "limit_operations_now", "monitor_field", "save_spring_water",
            "irrigation_optional", "check_soil_texture", "satellite_divergence"}


AFTER_HARVEST_KEYS = {"residue_cover", "cover_crop"}


@dataclass
class Result:
    retention: list[Rec] = field(default_factory=list)
    agrotechnical: list[Rec] = field(default_factory=list)
    irrigation: list[Rec] = field(default_factory=list)
    field_checks: list[Rec] = field(default_factory=list)
    irrigation_note: str | None = None


def vulnerability_sentence(f: Facts) -> str:
    return (f"W {f.seasons_with_long_stress} z {f.seasons_total} ostatnich sezonów bilans pokazał w okresie krytycznym "
            f"dla plonu stres wodny trwający co najmniej 14 dni.")


def is_vulnerable(f: Facts) -> bool:
    return f.seasons_total >= 5 and f.seasons_with_long_stress >= FREQUENT_STRESS_SEASONS


def soil_is_light(f: Facts) -> bool:
    return not f.soil_assumed and f.awc_mm_per_m < LOW_AWC_MM_PER_M


def is_stressed(f: Facts) -> bool:
    return f.class_key in DEFICIT_CLASSES


@dataclass(frozen=True)
class SowingWords:
    """Ziemniak się sadzi, resztę upraw się sieje."""
    noun: str
    before: str
    verb: str


def sowing_words(f: Facts) -> SowingWords:
    if f.crop_key == "potato":
        return SowingWords("sadzenia", "przed sadzeniem", "sadź")
    return SowingWords("siewu", "przed siewem", "siej")
