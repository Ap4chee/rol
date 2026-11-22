"""Plan prac polowych na 7 dni: ocena każdego dnia dla wjazdu w pole i uprawy, siewu, oprysków i nawożenia.

Wilgotność wierzchu gleby (0–10 cm) to bilans warstwy powierzchniowej FAO-56 (TEW, REW, równania 73–74)
na pogodzie z ostatnich 30 dni i prognozie, od pojemności polowej na początku okresu. To model, nie pomiar.
Progi niżej są UMOWNE (uproszczone reguły praktyki, nie norma). Reguły nie znają sprzętu, etykiet środków
ochrony roślin ani terminów z przepisów (np. programu azotanowego).
"""
from __future__ import annotations

from datetime import date, timedelta

from app.core.crops import GROWTH_TEMP_THRESHOLD_C, Crop, daily_crop_arrays
from app.core.ptf import REW_MM_BY_USDA, usda_texture_class
from app.core.soil import ASSUMED_CLAY_PCT, ASSUMED_SAND_PCT, layer_water
from app.core.water_balance import EVAPORATION_LAYER_M, KC_BARE_MAX, total_evaporable_water_mm

GOOD, CAUTION, AVOID, OFF, UNKNOWN = "good", "caution", "avoid", "off", "unknown"
OPERATIONS = ("traffic", "sowing", "spraying", "fertilizing")
_RANK = {GOOD: 0, CAUTION: 1, AVOID: 2}

# Model nie zna odcieku wody ponad pojemność polową (po ulewie gleba jest mokrzejsza, niż wynika z bilansu),
# więc progi są ostrożne: dzień po dużym deszczu wierzch ma 100% i wjazd jest odradzany.
WET_FC = 0.90             # wierzch powyżej 90% pojemności polowej: koleiny i ugniatanie
MOIST_FC = 0.85           # 85–90%: ostrożnie
RAIN_TRAFFIC_MM = 3.0     # opad w dniu pracy, przy którym wjazd odradzamy
SOW_DRY_AVAILABLE = 0.4   # poniżej 40% wody dostępnej w wierzchu nasiona słabo kiełkują
SOW_DAYS_BEFORE, SOW_DAYS_AFTER = 14, 21   # okno siewu wokół umownej daty siewu z crops.py
SPRAY_RAIN_MM, SPRAY_RAIN_MAX_MM = 1.0, 2.0
SPRAY_WIND_KMH, SPRAY_WIND_MAX_KMH = 15.0, 20.0
SPRAY_TMAX_C = (5.0, 25.0)
FERT_RAIN_MM, FERT_RAIN_MAX_MM = 2.0, 5.0
FERT_RUNOFF_MM, FERT_RUNOFF_MAX_MM = 10.0, 20.0   # opad w 2 kolejnych dniach: nawóz może spłynąć
SNOW_CODES = {71, 73, 75, 77, 85, 86}             # kody pogody WMO: śnieg

NOTES = [
    "Oceny są uproszczone, a progi umowne. Wilgotność wierzchu gleby to model z opadu i parowania, nie pomiar.",
    "Wiatr to największa prędkość w ciągu doby na wysokości 10 m. Rano i wieczorem zwykle wieje słabiej.",
    "Plan nie uwzględnia sprzętu, etykiet środków ochrony roślin ani terminów z programu azotanowego. "
    "Sprawdź je przed zabiegiem.",
    "Ostatnie dni prognozy są mniej pewne. Plan zmienia się razem z prognozą, więc sprawdzaj go codziennie.",
]


def surface_soil(sand_pct: float | None, clay_pct: float | None, soc_g_kg: float | None) -> tuple[float, float, float, bool]:
    """Pojemność polowa i punkt więdnięcia wierzchu [m3/m3] oraz REW [mm]; bez uziarnienia gleba umowna (True)."""
    assumed = sand_pct is None or clay_pct is None
    if assumed:
        sand_pct, clay_pct, soc_g_kg = ASSUMED_SAND_PCT, ASSUMED_CLAY_PCT, None
    water = layer_water(sand_pct, clay_pct, soc_g_kg)
    texture = usda_texture_class(sand_pct, max(100.0 - sand_pct - clay_pct, 0.0), clay_pct)
    return water.field_capacity, water.wilting_point, REW_MM_BY_USDA[texture], assumed


def surface_depletion_mm(rain_mm: list[float | None], et0_mm: list[float | None],
                         fc: float, wp: float, rew_mm: float) -> list[float | None]:
    """Wyczerpanie warstwy 0–10 cm na koniec każdego dnia [mm], start od pojemności polowej (De = 0).
    Od pierwszego dnia bez opadu albo ET0 stan jest nieznany (None), zamiast zgadywać."""
    tew = total_evaporable_water_mm(fc, wp)
    rew = min(rew_mm, tew)
    de: float | None = 0.0
    out = []
    for rain, et0 in zip(rain_mm, et0_mm):
        if de is None or rain is None or et0 is None:
            de = None
        else:
            kr = 1.0 if de <= rew else max((tew - de) / (tew - rew), 0.0) if tew > rew else 0.0   # (74)
            de = min(max(de - rain + kr * KC_BARE_MAX * et0, 0.0), tew)
        out.append(de)
    return out


def _judge(checks: list[tuple[str, str]], good_reason: str) -> dict:
    """Najgorsza ocena z wykrytych problemów i jej powody; bez problemów ocena dobra."""
    worst = max((_RANK[rating] for rating, _ in checks), default=0)
    if worst == 0:
        return {"rating": GOOD, "reason": good_reason}
    rating = next(r for r, k in _RANK.items() if k == worst)
    return {"rating": rating, "reason": "; ".join(text for r, text in checks if _RANK[r] == worst)}


def _mm(value: float) -> str:
    return f"{value:.0f} mm" if value >= 10 else f"{value:.1f} mm".replace(".", ",")


def _in_sowing_window(crop: Crop, day: date) -> bool:
    for year in (day.year - 1, day.year, day.year + 1):
        sowing = date(year, crop.sowing_month, crop.sowing_day)
        if sowing - timedelta(days=SOW_DAYS_BEFORE) <= day <= sowing + timedelta(days=SOW_DAYS_AFTER):
            return True
    return False


def _traffic(rain: float | None, rel_fc: float | None, snow: bool) -> dict:
    if snow:
        return {"rating": AVOID, "reason": "śnieg"}
    if rain is None or rel_fc is None:
        return {"rating": UNKNOWN, "reason": "brak prognozy opadu lub parowania, więc nie wiadomo, jak mokra jest gleba"}
    checks = []
    if rain >= RAIN_TRAFFIC_MM:
        checks.append((AVOID, f"opad {_mm(rain)}"))
    if rel_fc > WET_FC:
        checks.append((AVOID, "gleba mokra: koleiny i ugniatanie"))
    elif rel_fc > MOIST_FC:
        checks.append((CAUTION, "gleba wilgotna: lżejszy sprzęt, niższe ciśnienie w oponach"))
    return _judge(checks, "gleba obeschła, bez opadu")


def _sowing(crop: Crop, day: date, traffic: dict, available: float | None) -> dict:
    if crop.perennial:
        return {"rating": OFF, "reason": "użytek trwały, bez siewu"}
    if not _in_sowing_window(crop, day):
        return {"rating": OFF, "reason": f"poza terminem siewu (umownie ok. {crop.sowing_day:02d}.{crop.sowing_month:02d})"}
    if traffic["rating"] in (AVOID, UNKNOWN):
        return traffic
    checks = [(traffic["rating"], traffic["reason"])] if traffic["rating"] == CAUTION else []
    if available is not None and available < SOW_DRY_AVAILABLE:
        checks.append((CAUTION, "wierzch przesuszony: słabsze wschody"))
    return _judge(checks, "gleba obeschła, a wierzch ma wodę na wschody")


def _off_season(in_field: bool, stage: str) -> str | None:
    if not in_field:
        return "uprawy nie ma w polu (umowny kalendarz)"
    if stage == "dormant":
        return "spoczynek zimowy"
    return None


def _spraying(in_field: bool, stage: str, traffic: dict, rain: float | None, wind: float | None,
              tmax: float | None, snow: bool) -> dict:
    off = _off_season(in_field, stage)
    if off:
        return {"rating": OFF, "reason": off}
    if snow:
        return {"rating": AVOID, "reason": "śnieg"}
    if rain is None or tmax is None:
        return {"rating": UNKNOWN, "reason": "brak prognozy opadu lub temperatury"}
    checks = []
    if rain >= SPRAY_RAIN_MAX_MM:
        checks.append((AVOID, f"opad {_mm(rain)}: deszcz zmyje środek"))
    elif rain >= SPRAY_RAIN_MM:
        checks.append((CAUTION, f"opad {_mm(rain)}: pryskaj w suchej części dnia"))
    if wind is None:
        checks.append((CAUTION, "brak prognozy wiatru"))
    elif wind >= SPRAY_WIND_MAX_KMH:
        checks.append((AVOID, f"wiatr do {wind:.0f} km/h: ciecz będzie znoszona"))
    elif wind >= SPRAY_WIND_KMH:
        checks.append((CAUTION, f"wiatr do {wind:.0f} km/h: pryskaj rano lub wieczorem"))
    if tmax <= 0:
        checks.append((AVOID, "mróz przez cały dzień"))
    elif tmax < SPRAY_TMAX_C[0]:
        checks.append((CAUTION, f"chłodno ({tmax:.0f} °C): wiele środków działa słabo"))
    elif tmax > SPRAY_TMAX_C[1]:
        checks.append((CAUTION, f"upał ({tmax:.0f} °C): pryskaj rano lub wieczorem"))
    if traffic["rating"] == AVOID:
        checks.append((CAUTION, "mokro: jedź tylko ścieżkami technologicznymi"))
    return _judge(checks, "sucho, słaby wiatr, umiarkowana temperatura")


def _fertilizing(in_field: bool, stage: str, traffic: dict, rain: float | None, next_rain: float,
                 tmax: float | None, tmin: float | None, snow: bool) -> dict:
    off = _off_season(in_field, stage) or ("dojrzewanie: nawożenie nic nie da" if stage == "late" else None)
    if off:
        return {"rating": OFF, "reason": off}
    if snow:
        return {"rating": AVOID, "reason": "śnieg: nie nawozi się gleby pod śniegiem"}
    if rain is None:
        return {"rating": UNKNOWN, "reason": "brak prognozy opadu"}
    checks = []
    if tmax is not None and tmax <= 0:
        checks.append((AVOID, "gleba może być zamarznięta"))
    elif tmax is not None and tmin is not None and (tmax + tmin) / 2 < GROWTH_TEMP_THRESHOLD_C:
        checks.append((AVOID, "wegetacja stoi (średnia temperatura poniżej 5 °C): rośliny nie pobiorą azotu"))
    if traffic["rating"] in (AVOID, CAUTION):
        checks.append((traffic["rating"], traffic["reason"]))
    if rain >= FERT_RAIN_MAX_MM:
        checks.append((AVOID, f"opad {_mm(rain)}: nawóz spłynie"))
    elif rain >= FERT_RAIN_MM:
        checks.append((CAUTION, f"opad {_mm(rain)}"))
    if next_rain >= FERT_RUNOFF_MAX_MM:
        checks.append((AVOID, f"w 2 kolejnych dniach {_mm(next_rain)} opadu: nawóz spłynie lub się wymyje"))
    elif next_rain >= FERT_RUNOFF_MM:
        checks.append((CAUTION, f"w 2 kolejnych dniach {_mm(next_rain)} opadu: ryzyko spływu"))
    return _judge(checks, "gleba nośna, bez dużego opadu w najbliższych dniach")


def best_windows(days: list[dict]) -> dict[str, dict]:
    """Najdłuższy ciąg kolejnych dobrych dni dla każdej pracy (przy remisie najwcześniejszy)."""
    windows = {}
    for op in OPERATIONS:
        best, start = None, None
        for i, day in enumerate([*days, None]):
            good = day is not None and day[op]["rating"] == GOOD
            if good and start is None:
                start = i
            if not good and start is not None:
                if best is None or i - start > best[1] - best[0] + 1:
                    best = (start, i - 1)
                start = None
        if best:
            windows[op] = {"date_from": days[best[0]]["date"], "date_to": days[best[1]]["date"]}
    return windows


def plan_fieldwork(dates: list[date], rain_mm: list[float | None], et0_mm: list[float | None],
                   tmax_c: list[float | None], tmin_c: list[float | None], wind_kmh: list[float | None],
                   weather_codes: list[int | None], n_recent: int, crop: Crop,
                   fc: float, wp: float, rew_mm: float) -> list[dict]:
    """Oceny prac dla dni prognozy. Listy obejmują kolejne dni: najpierw `n_recent` dni przed dziś, potem prognozę.

    Każda ocena: good | caution | avoid | off (poza sezonem tej pracy) | unknown (brak danych), z powodem.
    Wilgotność wierzchu w danym dniu to stan rano (koniec poprzedniej doby).
    """
    depletion = surface_depletion_mm(rain_mm, et0_mm, fc, wp, rew_mm)
    crop_daily = daily_crop_arrays(crop, dates)
    days = []
    for i in range(n_recent, len(dates)):
        de = depletion[i - 1] if i > 0 else 0.0
        theta = None if de is None else fc - de / (1000.0 * EVAPORATION_LAYER_M)
        rel_fc = None if theta is None else theta / fc
        available = None if theta is None else min(max((theta - wp) / (fc - wp), 0.0), 1.0) if fc > wp else None
        rain, snow = rain_mm[i], weather_codes[i] in SNOW_CODES
        next_rain = sum(r for r in rain_mm[i + 1:i + 3] if r is not None)
        in_field, stage = bool(crop_daily.in_field[i]), crop_daily.stage[i]
        traffic = _traffic(rain, rel_fc, snow)
        days.append({
            "date": dates[i], "rain_mm": None if rain is None else round(rain, 1), "wind_max_kmh": wind_kmh[i],
            "temperature_max_c": tmax_c[i], "temperature_min_c": tmin_c[i], "weather_code": weather_codes[i],
            "surface_fc_pct": None if rel_fc is None else round(100 * rel_fc),
            "traffic": traffic,
            "sowing": _sowing(crop, dates[i], traffic, available),
            "spraying": _spraying(in_field, stage, traffic, rain, wind_kmh[i], tmax_c[i], snow),
            "fertilizing": _fertilizing(in_field, stage, traffic, rain, next_rain, tmax_c[i], tmin_c[i], snow),
        })
    return days
