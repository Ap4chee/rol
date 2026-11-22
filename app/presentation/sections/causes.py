"""Sekcja 2 raportu: przyczyny niedoboru. Każda przyczyna wynika z progu przekroczonego w danych tej działki."""
from __future__ import annotations

from datetime import timedelta

import numpy as np

from app.config import HISTORY_YEARS
from app.core import analysis
from app.core.balance_run import Computed
from app.core.crops import STAGE_NAMES_PL, last_completed_season
from app.core.textfmt import fmt, fmt_date
from app.schemas import Cause, CausesSection, HydrologySection, Status, WaterStatus, WeatherWindow

RAIN_DEFICIT_PCT = 75.0     # opad poniżej tego odsetka mediany z 10 lat uznajemy za przyczynę
ET0_EXCESS_PCT = 110.0      # ET0 powyżej tego odsetka mediany z 10 lat uznajemy za przyczynę
MIN_DIFFERENCE_MM = 10.0    # i tylko wtedy, gdy różnica od mediany to co najmniej tyle milimetrów
LOW_AWC_M3_M3 = 0.10        # mniej niż 100 mm wody dostępnej na metr gleby = mała pojemność
HIGH_DEMAND_KC = 1.0        # Kc od 1,0 w górę: uprawa zużywa co najmniej tyle, ile trawa wzorcowa
WINDOWS_DAYS = (30, 60, 90)
DEFICIT_CLASSES = ("moderate", "severe")


def _window(r: analysis.WindowStats) -> WeatherWindow:
    def rounded(value: float | None) -> float | None:
        return round(value, 0) if value is not None else None
    return WeatherWindow(
        days=r.days, rain_mm=round(r.rain_mm, 0), et0_mm=round(r.et0_mm, 0),
        rain_median_mm=rounded(r.rain_median_mm), et0_median_mm=rounded(r.et0_median_mm),
        rain_pct_of_median=rounded(r.rain_pct_of_median), et0_pct_of_median=rounded(r.et0_pct_of_median),
        years_compared=r.years_compared)


def _weather_causes(windows: list[WeatherWindow]) -> list[Cause]:
    items = []
    dry = [w for w in windows if w.rain_pct_of_median is not None and w.rain_pct_of_median < RAIN_DEFICIT_PCT
           and w.rain_median_mm - w.rain_mm >= MIN_DIFFERENCE_MM]
    if dry:
        parts = [f"{w.days} dni: {fmt(w.rain_mm)} mm, czyli {fmt(w.rain_pct_of_median)}% mediany ({fmt(w.rain_median_mm)} mm)"
                 for w in dry]
        items.append(Cause(
            key="rain_deficit", title="Mało opadu",
            text="Spadło mniej niż 75% tego, co zwykle pada w tym samym okresie (mediana z 10 lat). " + "; ".join(parts) + ".",
            evidence={"windows": [w.days for w in dry]}))
    hot = [w for w in windows if w.et0_pct_of_median is not None and w.et0_pct_of_median > ET0_EXCESS_PCT
           and w.et0_mm - w.et0_median_mm >= MIN_DIFFERENCE_MM]
    if hot:
        parts = [f"{w.days} dni: {fmt(w.et0_mm)} mm, czyli {fmt(w.et0_pct_of_median)}% mediany ({fmt(w.et0_median_mm)} mm)"
                 for w in hot]
        items.append(Cause(
            key="high_et0", title="Duże parowanie",
            text="Ciepło, słońce i wiatr zabierają z gleby i roślin ponad 110% tego, co zwykle w tym samym okresie "
                 "(parowanie wzorcowe FAO, mediana z 10 lat). " + "; ".join(parts) + ".",
            evidence={"windows": [w.days for w in hot]}))
    return items


def _soil_cause(c: Computed) -> Cause | None:
    variant = c.main_variant
    awc = variant.fc_root - variant.wp_root
    if awc >= LOW_AWC_M3_M3:
        return None
    return Cause(
        key="low_soil_capacity", title="Mała pojemność wodna gleby",
        text=f"Gleba utrzymuje tylko {fmt(awc * 1000)} mm wody dostępnej dla roślin na każdy metr głębokości: "
             f"po deszczu zatrzymuje wodę równą {fmt(variant.fc_root * 100)}% swojej objętości, a ostatnich "
             f"{fmt(variant.wp_root * 100)}% korzenie już nie pobiorą. Zapas z opadów wyczerpuje się szybko "
             "nawet przy przeciętnej pogodzie.",
        evidence={"available_mm_per_m": round(awc * 1000)})


def _demand_cause(c: Computed) -> Cause | None:
    kc = c.crop_daily.kc[-1]
    stage = c.crop_daily.stage[-1]
    # w fazie dojrzewania Kc spada od wartości szczytowej, ale zapotrzebowanie przestaje decydować o plonie
    if not (c.in_season and stage in ("development", "mid") and np.isfinite(kc) and kc >= HIGH_DEMAND_KC):
        return None
    etc = float(c.main.etc_mm[-7:].mean())
    return Cause(
        key="high_demand_stage", title="Faza dużego zapotrzebowania uprawy",
        text=f"{c.crop.name} jest w fazie: {STAGE_NAMES_PL[stage]} i zużywa teraz średnio "
             f"{fmt(etc, 1)} mm wody na dobę (średnia z 7 dni).",
        evidence={"kc": round(float(kc), 2), "etc_mm_day": round(etc, 1)})


def _carry_over_cause(c: Computed) -> Cause | None:
    """Niedobór przeniesiony z minionego sezonu: zapas nie odbudował się po zbiorze."""
    now = c.assessment
    if c.crop_daily.stage[-1] not in ("off_season", "initial", "dormant") or now.depletion_mm <= 0.5 * now.raw_mm:
        return None
    previous = last_completed_season(c.crop, c.dates[-1])
    i_harvest = analysis.index_of(c.dates, previous.harvest - timedelta(days=1))
    if i_harvest is None or i_harvest >= len(c.dates) - 1:
        return None
    at_harvest = float(c.main.depletion_mm[i_harvest])
    rain_since = float(c.series.rain_mm[i_harvest + 1:].sum())
    if at_harvest <= now.depletion_mm * 0.5:
        return None
    return Cause(
        key="carry_over", title="Zapas nie odbudował się po minionym sezonie",
        text=f"Na koniec minionego sezonu ({fmt_date(previous.harvest - timedelta(days=1))}) w glebie brakowało "
             f"{fmt(at_harvest)} mm wody. Od tego dnia spadło {fmt(rain_since)} mm opadu, a ubytek zmalał tylko do "
             f"{fmt(now.depletion_mm)} mm: część opadu odparowała z powierzchni, zanim wsiąkła głębiej.",
        evidence={"depletion_at_harvest_mm": round(at_harvest), "rain_since_mm": round(rain_since)})


def _no_cause_reason(status: WaterStatus) -> str:
    if status.class_key in DEFICIT_CLASSES:
        return ("Bilans pokazuje niedobór, ale żaden z badanych czynników nie przekracza progu "
                "(opad poniżej 75% zwykłego, parowanie powyżej 110% zwykłego, mała pojemność gleby, "
                "faza dużego zapotrzebowania). "
                "Niedobór narastał stopniowo przez okres dłuższy niż 90 dni.")
    return ("W danych nie ma czynników, które tłumaczyłyby niedobór: opad i parowanie mieszczą się "
            "w zakresie typowym dla ostatnich 10 lat, a faza uprawy nie zwiększa zapotrzebowania.")


def causes_section(c: Computed, status: WaterStatus, soil_assumed: bool) -> CausesSection:
    rows = analysis.weather_windows(c.dates, c.series.rain_mm, c.series.et0_mm, WINDOWS_DAYS, HISTORY_YEARS)
    windows = [_window(r) for r in rows]
    items = _weather_causes(windows)
    not_assessed: list[str] = []
    if not windows or windows[0].rain_median_mm is None:
        not_assessed.append("Porównanie opadu i ET0 z medianą 10 lat: seria pogodowa jest za krótka.")
    if soil_assumed:
        not_assessed.append("Pojemność wodna gleby: brak danych o glebie, przyjęto glebę umowną.")
        others = [_demand_cause(c), _carry_over_cause(c)]
    else:
        others = [_soil_cause(c), _demand_cause(c), _carry_over_cause(c)]
    items += [cause for cause in others if cause is not None]
    not_assessed.append("Spadek terenu i skoncentrowany spływ: liczone osobno, wynik pojawia się w części o terenie.")
    reason = None if items else _no_cause_reason(status)
    return CausesSection(status=Status.ok, reason=reason, windows=windows, items=items, not_assessed=not_assessed)


def hydrology_cause(hydro: HydrologySection) -> Cause | None:
    """Niski stan rzeki jako przyczyna (tło regionalne), tylko gdy porównanie wypadło nisko."""
    if hydro.status != Status.ok or hydro.class_key not in ("low", "very_low"):
        return None
    what = "Przepływ" if hydro.metric == "flow" else "Stan wody"
    return Cause(
        key="low_river_flow", title="Mało wody w rzekach okolicy",
        text=f"{what} na wodowskazie {hydro.station_name} ({hydro.river}, {fmt(hydro.station_distance_km)} km od działki) "
             f"jest niski: w tych samych dniach roku był wyższy niż teraz w {hydro.years_higher} z {hydro.years_compared} "
             "poprzednich lat. "
             "Zasoby wody w zlewni są małe: susza nie dotyczy tylko gleby, ale też wód powierzchniowych.",
        evidence={"station_id": hydro.station_id, "years_higher": hydro.years_higher,
                  "years_compared": hydro.years_compared})


def add_river_cause(causes: CausesSection, hydro: HydrologySection, status: WaterStatus) -> None:
    """Niski stan rzeki dołącza do przyczyn; gdy to jedyny trop przy braku niedoboru, znika zdanie „brak przyczyn”."""
    river_cause = hydrology_cause(hydro)
    if river_cause is None:
        return
    if not causes.items and status.class_key not in DEFICIT_CLASSES:
        causes.reason = None
    causes.items.append(river_cause)
