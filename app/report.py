"""Składanie raportu: pobranie źródeł równolegle, obliczenia, teksty wniosków.

Kolejność analizy jest narzucona przez zadanie: sytuacja wodna → przyczyny → rekomendacje
(retencja, agrotechnika, nawadnianie). Awaria pojedynczego źródła nie przerywa raportu:
brak jest nazwany w `sources`, a jego wpływ na wniosek opisany.
"""
from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import httpx
import numpy as np
from fastapi import HTTPException

from app.config import HISTORY_YEARS, USER_AGENT, WARMUP_DAYS
from app.core import analysis
from app.core.crops import (
    CROPS,
    GROWTH_TEMP_THRESHOLD_C,
    STAGE_NAMES_PL,
    Crop,
    CropDaily,
    daily_crop_arrays,
    last_completed_season,
    season_containing,
    season_for_harvest_year,
)
from app.core.soil import SoilVariant, assumed_variant
from app.core.water_balance import (
    CLASS_KEYS,
    CLASS_LABELS_IN_SEASON,
    CLASS_LABELS_OFF_SEASON,
    BalanceResult,
    classify,
    run_water_balance,
    stress_coefficient,
    total_available_water_mm,
    total_evaporable_water_mm,
)
from app.schemas import (
    BalanceVariant,
    Cause,
    CausesSection,
    ClimaticWaterBalance,
    CropInfo,
    CropParameter,
    DailyPoint,
    HistorySection,
    HydrologySection,
    ParcelInfo,
    Point,
    Recommendations,
    ReportRequest,
    ReportResponse,
    SatelliteSection,
    SeasonStress,
    SeasonSummary,
    SoilSection,
    SourceInfo,
    Status,
    TerrainRef,
    WaterStatus,
    WeatherWindow,
)
from app.sources import NoData, SourceError, uldk, weather
from app.textfmt import fmt, fmt_date, plural_days

WARSAW = ZoneInfo("Europe/Warsaw")
MIN_ANALYSIS_DATE = date(2005, 1, 1)
SERIES_DAYS_FOR_CHART = 180
NOT_CONNECTED = "Ta część analizy nie jest jeszcze podłączona."

MODEL_LIMITATIONS = [
    "Bilans nie uwzględnia spływu powierzchniowego: cały opad jest liczony jako woda, która wsiąka. "
    "Po ulewie i na stoku rzeczywisty zapas jest mniejszy.",
    "Bilans nie uwzględnia podsiąku z płytkiej wody gruntowej ani drenów. Na polach z wysokim "
    "poziomem wody gruntowej rzeczywisty niedobór jest mniejszy, niż pokazuje raport.",
    "Śnieg jest liczony jak deszcz w dniu opadu, a zamarznięcie gleby nie jest modelowane.",
    "Nawadnianie jest nieznane i nie wchodzi do bilansu. Jeśli pole było nawadniane, niedobór jest zawyżony.",
    "Pogoda pochodzi z siatki modelu, a nie z pomiaru na polu. Lokalna burza albo jej brak mogą "
    "zmienić wynik o kilkadziesiąt milimetrów.",
    "Terminy siewu, faz rozwoju i zbioru są przyjęte umownie dla Polski, a głębokość korzeni jest "
    "stała przez cały sezon. Wczesny albo późny siew przesuwa okres największego zapotrzebowania.",
    "Współczynniki Kc pochodzą z tablic FAO-56 bez poprawki na lokalny wiatr i wilgotność powietrza.",
    "Porównanie z 10 latami zakłada, że co roku na polu rosła ta sama uprawa.",
]


def today_warsaw() -> date:
    return datetime.now(WARSAW).date()


# ---------- działka ----------

def _parcel_info(parcel: uldk.Parcel) -> ParcelInfo:
    lon, lat = parcel.centroid_lonlat
    minx, miny, maxx, maxy = parcel.geometry.bounds
    return ParcelInfo(
        id=parcel.id, number=parcel.number, region=parcel.region, commune=parcel.commune,
        county=parcel.county, voivodeship=parcel.voivodeship, area_ha=round(parcel.area_ha, 4),
        centroid=Point(lon=round(lon, 6), lat=round(lat, 6)), geometry=parcel.geojson(),
        bbox=[minx, miny, maxx, maxy])


async def resolve_parcel(client: httpx.AsyncClient, request: ReportRequest) -> tuple[uldk.Parcel | None, SourceInfo]:
    """Działka z ULDK. Przy awarii ULDK i podanym punkcie raport powstaje dla samego punktu."""
    t0 = time.perf_counter()
    info = SourceInfo(
        key="uldk", name="ULDK GUGiK (Usługa Lokalizacji Działek Katastralnych)", status=Status.ok,
        resolution="granica działki ewidencyjnej (wektor)", url="https://uldk.gugik.gov.pl/",
        license="dane państwowego zasobu geodezyjnego udostępniane bezpłatnie (szczegóły w README)",
        data_date="stan ewidencji w dniu pobrania")
    try:
        if request.parcel_id:
            parcel, from_cache = await uldk.get_parcel_by_id(client, request.parcel_id)
        else:
            parcel, from_cache = await uldk.get_parcel_by_point(client, request.point.lon, request.point.lat)
    except NoData as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except (SourceError, RuntimeError) as exc:
        if request.point is None:
            raise HTTPException(
                status_code=502,
                detail=f"Nie udało się pobrać działki z ULDK ({exc}). Spróbuj ponownie albo wskaż punkt na mapie.",
            ) from exc
        info.status = Status.error
        info.reason = str(exc)
        info.impact = ("Raport policzono dla wskazanego punktu, bez granicy działki: nie ma powierzchni, "
                       "wskaźników satelitarnych dla pola ani analizy spływu.")
        info.elapsed_s = round(time.perf_counter() - t0, 2)
        return None, info
    info.from_cache = from_cache
    info.elapsed_s = round(time.perf_counter() - t0, 2)
    return parcel, info


# ---------- pogoda → źródła ----------

def weather_sources(result: weather.WeatherResult) -> list[SourceInfo]:
    out: list[SourceInfo] = []
    for attempt in result.attempts:
        meta = weather.PROVIDERS[attempt.provider]
        recent = attempt.provider == "open_meteo_forecast"
        info = SourceInfo(
            key="weather_recent" if recent else "weather", name=meta["name"],
            status=Status.ok if attempt.ok else Status.error, reason=attempt.reason,
            resolution=meta["resolution"], license=meta["license"], url=meta["url"],
            data_from=attempt.data_from, data_to=attempt.data_to,
            from_cache=attempt.from_cache, elapsed_s=attempt.elapsed_s, notes=list(attempt.notes))
        if not attempt.ok:
            if recent:
                info.impact = "Bilans kończy się na ostatnim dniu archiwum, kilka dni przed datą analizy."
            elif result.series is not None:
                info.impact = "Bez wpływu na wynik: użyto drugiego dostawcy pogody."
            else:
                info.impact = "Bez pogody nie da się policzyć bilansu wodnego ani oceny niedoboru."
        elif attempt.provider == result.provider:
            info.notes.append("Cała wieloletnia seria pochodzi z tego jednego dostawcy.")
            if result.interpolated_et0_days or result.missing_rain_days:
                info.notes.append(
                    f"Braki w środku serii: ET0 uzupełniono interpolacją w {plural_days(result.interpolated_et0_days)}, "
                    f"opad przyjęto jako 0 mm w {plural_days(result.missing_rain_days)}.")
        out.append(info)
    return out


# ---------- bilans ----------

@dataclass
class Computed:
    dates: list[date]
    series: weather.DailyWeather
    crop: Crop
    crop_daily: CropDaily
    variants: list[SoilVariant]
    balances: dict[str, BalanceResult]
    main_key: str
    in_field: bool
    in_season: bool
    tmean_10d_c: float | None

    @property
    def main(self) -> BalanceResult:
        return self.balances[self.main_key]


def compute(series: weather.DailyWeather, crop: Crop, variants: list[SoilVariant]) -> Computed:
    dates = series.dates
    crop_daily = daily_crop_arrays(crop, dates)
    balances: dict[str, BalanceResult] = {}
    for variant in variants:
        taw = total_available_water_mm(variant.fc_root, variant.wp_root, crop.root_depth_m)
        tew = total_evaporable_water_mm(variant.fc_top, variant.wp_top)
        balances[variant.key] = run_water_balance(
            series.rain_mm, series.et0_mm, crop_daily.kc, crop_daily.in_field,
            taw_mm=taw, p_table=crop.p, tew_mm=tew, rew_mm=variant.rew_mm)
    tmean = (series.tmin_c[-10:] + series.tmax_c[-10:]) / 2.0
    tmean_10d = float(np.nanmean(tmean)) if np.isfinite(tmean).sum() >= 5 else None
    in_field = bool(crop_daily.in_field[-1]) and crop_daily.stage[-1] != "dormant"
    in_season = in_field and (tmean_10d is None or tmean_10d >= GROWTH_TEMP_THRESHOLD_C)
    return Computed(dates, series, crop, crop_daily, variants, balances, variants[0].key,
                    in_field, in_season, tmean_10d)


def variant_result(variant: SoilVariant, balance: BalanceResult, in_season: bool) -> BalanceVariant:
    dr = float(balance.depletion_mm[-1])
    taw = float(balance.taw_mm)
    raw = float(balance.raw_mm[-1])
    p = raw / taw if taw > 0 else 0.5
    key = classify(dr, raw, taw)
    labels = CLASS_LABELS_IN_SEASON if in_season else CLASS_LABELS_OFF_SEASON
    return BalanceVariant(
        key=variant.key, label=variant.label,
        field_capacity_vol_pct=round(variant.fc_root * 100, 1), wilting_point_vol_pct=round(variant.wp_root * 100, 1),
        taw_mm=round(taw, 0), raw_mm=round(raw, 0), depletion_mm=round(dr, 0),
        depletion_pct_taw=round(100 * dr / taw, 0) if taw > 0 else 100.0,
        available_mm=round(max(taw - dr, 0.0), 0), ks=round(stress_coefficient(dr, taw, p), 2),
        class_key=key, class_label=labels[key])


def crop_info(c: Computed, analysis_date: date) -> CropInfo:
    crop = c.crop
    last = c.dates[-1]
    season = season_containing(crop, last)
    stage = c.crop_daily.stage[-1]
    kc = float(c.crop_daily.kc[-1]) if np.isfinite(c.crop_daily.kc[-1]) else None
    if season is None:
        season = last_completed_season(crop, last)
        if crop.perennial:
            season = season_for_harvest_year(crop, last.year)
    assumptions = [crop.sources["stages"], *crop.assumptions]
    if crop.perennial:
        assumptions.append("Użytek zielony jest uprawą trwałą: sezon liczony od 1 IV do 31 X.")
    return CropInfo(
        key=crop.key, name=crop.name, in_season=c.in_season, stage_key=stage, stage_name=STAGE_NAMES_PL[stage],
        kc=round(kc, 2) if kc is not None else None, root_depth_m=crop.root_depth_m, depletion_fraction_p=crop.p,
        season_from=season.sowing, season_to=season.harvest - timedelta(days=1),
        critical_from=season.critical_start, critical_to=season.critical_end - timedelta(days=1),
        parameters=[
            CropParameter(name="Współczynniki uprawy Kc (początek / środek / koniec sezonu)",
                          value=f"{fmt(crop.kc_ini, 2)} / {fmt(crop.kc_mid, 2)} / {fmt(crop.kc_end, 2)}",
                          source=crop.sources["kc"]),
            CropParameter(name="Głębokość korzeni Zr i frakcja p", value=f"{fmt(crop.root_depth_m, 1)} m; p = {fmt(crop.p, 2)}",
                          source=crop.sources["root"]),
            CropParameter(name="Długości faz [dni]", value=" / ".join(str(d) for d in crop.stage_days),
                          source=crop.sources["stages"]),
        ],
        assumptions=assumptions)


def _season_reason(c: Computed) -> str:
    """Dlaczego uprawa nie jest w okresie wzrostu (zdanie do raportu)."""
    crop, last = c.crop, c.dates[-1]
    if not c.in_field:
        if crop.perennial:
            return (f"{crop.name}: {fmt_date(last)} to czas poza sezonem wegetacyjnym "
                    "(przyjęty sezon 1 IV–31 X), darń jest w spoczynku.")
        previous = last_completed_season(crop, last)
        upcoming = season_for_harvest_year(crop, previous.label + 1)
        return (f"{crop.name} nie rośnie teraz na polu: według przyjętego kalendarza zbiór przypadał "
                f"{fmt_date(previous.harvest - timedelta(days=1))}, a siew kolejnego sezonu {fmt_date(upcoming.sowing)}.")
    season = season_containing(crop, last)
    sown = f"po siewie ({fmt_date(season.sowing)}) " if season and not crop.perennial else ""
    return (f"{crop.name} jest {sown}w polu, ale średnia temperatura z ostatnich 10 dni to "
            f"{fmt(c.tmean_10d_c, 1)} °C, poniżej progu wzrostu {fmt(GROWTH_TEMP_THRESHOLD_C, 0)} °C: "
            "rośliny praktycznie nie rosną i prawie nie pobierają wody.")


def water_status(c: Computed, soil_assumed: bool) -> WaterStatus:
    last = c.dates[-1]
    results = [variant_result(v, c.balances[v.key], c.in_season) for v in c.variants]
    main = results[0]
    balance = c.main
    text: list[str] = []

    if c.in_season:
        headline = main.class_label
        text.append(
            f"Stan na {fmt_date(last)}: w strefie korzeni (do {fmt(c.crop.root_depth_m, 1)} m) brakuje "
            f"{fmt(main.depletion_mm)} mm wody do pełnego zapasu. Roślinom zostaje {fmt(main.available_mm)} mm "
            f"wody dostępnej z {fmt(main.taw_mm)} mm, które ta gleba może utrzymać (TAW).")
        etc_7d = float(balance.etc_mm[-7:].mean())
        if main.depletion_mm > main.raw_mm:
            text.append(
                f"Wyczerpanie przekroczyło próg wody łatwo dostępnej (RAW = {fmt(main.raw_mm)} mm) o "
                f"{fmt(main.depletion_mm - main.raw_mm)} mm. Rośliny pobierają wodę z trudem: zużycie spada do "
                f"ok. {fmt(main.ks * 100)}% potrzeb (współczynnik stresu Ks = {fmt(main.ks, 2)}).")
        else:
            margin = main.raw_mm - main.depletion_mm
            sentence = (f"Do progu stresu (RAW = {fmt(main.raw_mm)} mm) zostaje {fmt(margin)} mm.")
            if etc_7d > 0.3:
                sentence += (f" Przy zużyciu z ostatnich 7 dni ({fmt(etc_7d, 1)} mm na dobę) i bez opadu "
                             f"wystarczy to na ok. {plural_days(max(int(margin / etc_7d), 0))}.")
            text.append(sentence)
    else:
        headline = "Uprawa nie jest w okresie wzrostu. " + main.class_label + "."
        text.append(_season_reason(c))
        text.append(
            f"Stan zapasu wody w glebie na {fmt_date(last)}: w warstwie do {fmt(c.crop.root_depth_m, 1)} m jest "
            f"{fmt(main.available_mm)} mm wody dostępnej dla roślin z {fmt(main.taw_mm)} mm możliwych "
            f"(brakuje {fmt(main.depletion_mm)} mm, czyli {fmt(main.depletion_pct_taw)}%).")

    # niepewność z wariantów gleby
    spans = False
    if soil_assumed:
        uncertainty = ("Brak danych o glebie: przyjęto glebę umowną (glina), więc wynik jest orientacyjny, "
                       "a przedziału niepewności gleby nie policzono.")
    elif len(results) > 1:
        ordered = sorted(results, key=lambda r: CLASS_KEYS.index(r.class_key))
        low, high = ordered[0], ordered[-1]
        pcts = [r.depletion_pct_taw for r in results]
        spans = low.class_key != high.class_key
        uncertainty = (
            f"Niepewność gleby: dla granic przedziału SoilGrids (5–95%) woda dostępna ogółem wynosi od "
            f"{fmt(min(r.taw_mm for r in results))} do {fmt(max(r.taw_mm for r in results))} mm, a wyczerpanie od "
            f"{fmt(min(pcts))}% do {fmt(max(pcts))}% zapasu.")
        if spans:
            uncertainty += (f" Przedział obejmuje więcej niż jedną klasę: od „{low.class_label}” do "
                            f"„{high.class_label}”. Bez badania gleby na polu nie da się tego rozstrzygnąć.")
        else:
            uncertainty += f" W całym przedziale klasa jest ta sama: „{main.class_label}”."
    else:
        uncertainty = "SoilGrids nie podał kwantyli dla tej działki, więc przedziału niepewności gleby nie policzono."

    # klimatyczny bilans wodny 60 dni
    cwb_model = None
    cwb = analysis.climatic_water_balance(c.dates, c.series.rain_mm, c.series.et0_mm, 60, HISTORY_YEARS)
    if cwb:
        cwb_text = (f"Klimatyczny bilans wodny (opad − ET0) z 60 dni do {fmt_date(cwb['date_to'])}: "
                    f"{fmt(cwb['rain_mm'])} − {fmt(cwb['et0_mm'])} = {fmt(cwb['balance_mm'])} mm.")
        if cwb["median_10y_mm"] is not None:
            cwb_text += (f" Mediana z {cwb['years_compared']} poprzednich lat dla tego samego okresu: "
                         f"{fmt(cwb['median_10y_mm'])} mm; suchszy był on w {cwb['drier_years']} z nich.")
        cwb_model = ClimaticWaterBalance(
            days=60, date_from=cwb["date_from"], date_to=cwb["date_to"], rain_mm=round(cwb["rain_mm"], 0),
            et0_mm=round(cwb["et0_mm"], 0), balance_mm=round(cwb["balance_mm"], 0),
            median_10y_mm=round(cwb["median_10y_mm"], 0) if cwb["median_10y_mm"] is not None else None,
            years_compared=cwb["years_compared"], drier_years=cwb["drier_years"], text=cwb_text)

    # miniony sezon
    last_season_model = None
    previous = last_completed_season(c.crop, last)
    summary = analysis.season_summary(c.dates, previous, c.crop_daily, balance, c.series.rain_mm)
    if summary:
        if summary["stress_days_critical"] > 0:
            stress_text = (f"w okresie krytycznym dla plonu stres wodny trwał {plural_days(summary['stress_days_critical'])}, "
                           f"a w całym sezonie {plural_days(summary['stress_days'])} "
                           f"(najdłuższy ciąg {plural_days(summary['longest_stress_run_days'])})")
        elif summary["stress_days"] > 0:
            stress_text = (f"stres wodny wystąpił przez {plural_days(summary['stress_days'])}, "
                           "ale poza okresem krytycznym dla plonu")
        else:
            stress_text = "bilans nie pokazał stresu wodnego"
        last_season_model = SeasonSummary(
            season=summary["season"], date_from=summary["date_from"], date_to=summary["date_to"],
            rain_mm=round(summary["rain_mm"], 0), etc_mm=round(summary["etc_mm"], 0),
            stress_days=summary["stress_days"], stress_days_critical=summary["stress_days_critical"],
            longest_stress_run_days=summary["longest_stress_run_days"],
            max_depletion_pct_taw=round(summary["max_depletion_pct_taw"], 0),
            text=(f"Miniony sezon ({fmt_date(summary['date_from'])}–{fmt_date(summary['date_to'])}): opad "
                  f"{fmt(summary['rain_mm'])} mm, zużycie wody przez uprawę {fmt(summary['etc_mm'])} mm; {stress_text}. "
                  f"Największe wyczerpanie zapasu: {fmt(summary['max_depletion_pct_taw'])}%."))

    n = min(SERIES_DAYS_FOR_CHART, len(c.dates))
    series = [
        DailyPoint(date=c.dates[i], rain_mm=round(float(c.series.rain_mm[i]), 1), et0_mm=round(float(c.series.et0_mm[i]), 2),
                   etc_mm=round(float(balance.eta_mm[i]), 2), depletion_mm=round(float(balance.depletion_mm[i]), 1),
                   raw_mm=round(float(balance.raw_mm[i]), 1), taw_mm=round(float(balance.taw_mm), 1))
        for i in range(len(c.dates) - n, len(c.dates))]

    return WaterStatus(
        status=Status.ok, headline=headline, class_key=main.class_key, class_label=main.class_label,
        in_season=c.in_season, last_data_day=last, soil_assumed=soil_assumed, result=main, variants=results,
        spans_classes=spans, uncertainty_text=uncertainty, climatic_water_balance=cwb_model,
        last_season=last_season_model, series=series, text=text)


# ---------- historia ----------

def history_section(c: Computed) -> HistorySection:
    rows = analysis.seasons_history(c.dates, c.crop, c.crop_daily, c.main, HISTORY_YEARS)
    last = c.dates[-1]
    past = [r for r in rows if r["complete"]][-HISTORY_YEARS:]
    current = next((r for r in rows if not r["complete"]), None)
    if len(past) < 3:
        return HistorySection(status=Status.no_data,
                              reason="Seria pogodowa obejmuje mniej niż 3 pełne sezony przed datą analizy.")
    seasons = [SeasonStress(**{**r, "max_depletion_pct_taw": round(r["max_depletion_pct_taw"], 0)}) for r in past]
    if current:
        seasons.append(SeasonStress(**{**current, "max_depletion_pct_taw": round(current["max_depletion_pct_taw"], 0)}))
    with_stress = [r for r in past if r["stressed"]]
    text = [
        f"Ten sam bilans policzono dla {len(past)} sezonów przed datą analizy, tak jakby co roku rosła tu "
        f"{c.crop.name.lower()}. W okresie krytycznym dla plonu stres wodny wystąpił w {len(with_stress)} z {len(past)} sezonów."
    ]
    if with_stress:
        days = sorted(r["stress_days_critical"] for r in with_stress)
        worst = max(with_stress, key=lambda r: r["stress_days_critical"])
        long_ones = sum(1 for d in days if d >= LONG_STRESS_DAYS)
        text.append(
            f"W sezonach ze stresem trwał on od {days[0]} do {plural_days(days[-1])} (mediana {fmt(float(np.median(days)))}), "
            f"a co najmniej {LONG_STRESS_DAYS} dni w {long_ones} z {len(past)} sezonów. "
            f"Najdłużej w sezonie {worst['season']}: {plural_days(worst['stress_days_critical'])}, "
            f"w tym {plural_days(worst['longest_stress_run_days'])} z rzędu.")
    if current:
        text.append(
            f"Bieżący sezon {current['season']} (okres krytyczny trwa do {fmt_date(current['critical_to'])}): "
            f"dotąd {plural_days(current['stress_days_critical'])} stresu.")
    pct = 100.0 * c.main.depletion_mm / c.main.taw_mm if c.main.taw_mm > 0 else np.zeros(len(c.dates))
    same = analysis.same_day_comparison(c.dates, pct, HISTORY_YEARS)
    section = HistorySection(status=Status.ok, seasons=seasons, seasons_with_stress=len(with_stress),
                             seasons_total=len(past), text=text)
    if same:
        section.same_day_current_pct = round(same["current_pct"], 0)
        section.same_day_median_pct = round(same["median_pct"], 0)
        section.same_day_drier_years = same["drier_years"]
        section.same_day_years = same["years"]
        text.append(
            f"Na tle tego samego dnia roku ({last.strftime('%d.%m')}) w {same['years']} poprzednich latach: dziś "
            f"wyczerpanie zapasu to {fmt(same['current_pct'])}%, mediana {fmt(same['median_pct'])}%; "
            f"bardziej sucho było w {same['drier_years']} z {same['years']} lat.")
    return section


# ---------- przyczyny ----------

RAIN_DEFICIT_PCT = 75.0     # opad poniżej tego odsetka mediany z 10 lat uznajemy za przyczynę
ET0_EXCESS_PCT = 110.0      # ET0 powyżej tego odsetka mediany z 10 lat uznajemy za przyczynę
MIN_DIFFERENCE_MM = 10.0    # i tylko wtedy, gdy różnica od mediany to co najmniej tyle milimetrów
LOW_AWC_M3_M3 = 0.10        # mniej niż 100 mm wody dostępnej na metr gleby = mała pojemność
LONG_STRESS_DAYS = 14       # „długi” stres w okresie krytycznym (do opisu historii)


def causes_section(c: Computed, status: WaterStatus, soil_assumed: bool) -> CausesSection:
    rows = analysis.weather_windows(c.dates, c.series.rain_mm, c.series.et0_mm, (30, 60, 90), HISTORY_YEARS)
    windows = [WeatherWindow(
        days=r["days"], rain_mm=round(r["rain_mm"], 0), et0_mm=round(r["et0_mm"], 0),
        rain_median_mm=round(r["rain_median_mm"], 0) if r["rain_median_mm"] is not None else None,
        et0_median_mm=round(r["et0_median_mm"], 0) if r["et0_median_mm"] is not None else None,
        rain_pct_of_median=round(r["rain_pct_of_median"], 0) if r["rain_pct_of_median"] is not None else None,
        et0_pct_of_median=round(r["et0_pct_of_median"], 0) if r["et0_pct_of_median"] is not None else None,
        years_compared=r["years_compared"]) for r in rows]
    items: list[Cause] = []
    not_assessed: list[str] = []

    dry = [w for w in windows if w.rain_pct_of_median is not None and w.rain_pct_of_median < RAIN_DEFICIT_PCT
           and w.rain_median_mm - w.rain_mm >= MIN_DIFFERENCE_MM]
    if dry:
        parts = [f"{w.days} dni: {fmt(w.rain_mm)} mm, czyli {fmt(w.rain_pct_of_median)}% mediany ({fmt(w.rain_median_mm)} mm)"
                 for w in dry]
        items.append(Cause(
            key="rain_deficit", title="Mało opadu",
            text="Opad poniżej 75% mediany z 10 lat dla tego samego okresu. " + "; ".join(parts) + ".",
            evidence={"windows": [w.days for w in dry]}))
    hot = [w for w in windows if w.et0_pct_of_median is not None and w.et0_pct_of_median > ET0_EXCESS_PCT
           and w.et0_mm - w.et0_median_mm >= MIN_DIFFERENCE_MM]
    if hot:
        parts = [f"{w.days} dni: {fmt(w.et0_mm)} mm, czyli {fmt(w.et0_pct_of_median)}% mediany ({fmt(w.et0_median_mm)} mm)"
                 for w in hot]
        items.append(Cause(
            key="high_et0", title="Duże parowanie",
            text="Ewapotranspiracja wskaźnikowa (ET0) powyżej 110% mediany z 10 lat: ciepło, słońce i wiatr "
                 "szybciej zabierają wodę. " + "; ".join(parts) + ".",
            evidence={"windows": [w.days for w in hot]}))
    if not windows or windows[0].rain_median_mm is None:
        not_assessed.append("Porównanie opadu i ET0 z medianą 10 lat: seria pogodowa jest za krótka.")

    main_variant = c.variants[0]
    awc = main_variant.fc_root - main_variant.wp_root
    if soil_assumed:
        not_assessed.append("Pojemność wodna gleby: brak danych o glebie, przyjęto glebę umowną.")
    elif awc < LOW_AWC_M3_M3:
        items.append(Cause(
            key="low_soil_capacity", title="Mała pojemność wodna gleby",
            text=f"Gleba utrzymuje tylko {fmt(awc * 1000)} mm wody dostępnej na każdy metr głębokości "
                 f"(pojemność polowa {fmt(main_variant.fc_root * 100)}%, punkt więdnięcia {fmt(main_variant.wp_root * 100)}% "
                 "objętości). Zapas z opadów wyczerpuje się szybko nawet przy przeciętnej pogodzie.",
            evidence={"available_mm_per_m": round(awc * 1000)}))

    kc = c.crop_daily.kc[-1]
    if c.in_season and np.isfinite(kc) and kc >= 1.0:
        etc = float(c.main.etc_mm[-7:].mean())
        items.append(Cause(
            key="high_demand_stage", title="Faza dużego zapotrzebowania uprawy",
            text=f"{c.crop.name} jest w fazie: {STAGE_NAMES_PL[c.crop_daily.stage[-1]]} (Kc = {fmt(float(kc), 2)}). "
                 f"Potrzebuje teraz średnio {fmt(etc, 1)} mm wody na dobę (średnia z 7 dni).",
            evidence={"kc": round(float(kc), 2), "etc_mm_day": round(etc, 1)}))

    # Niedobór przeniesiony z minionego sezonu: zapas nie odbudował się po zbiorze.
    stage = c.crop_daily.stage[-1]
    if stage in ("off_season", "initial", "dormant") and status.result and status.result.depletion_mm > 0.5 * status.result.raw_mm:
        previous = last_completed_season(c.crop, c.dates[-1])
        i_harvest = analysis.index_of(c.dates, previous.harvest - timedelta(days=1))
        if i_harvest is not None and i_harvest < len(c.dates) - 1:
            at_harvest = float(c.main.depletion_mm[i_harvest])
            rain_since = float(c.series.rain_mm[i_harvest + 1:].sum())
            if at_harvest > status.result.depletion_mm * 0.5:
                items.append(Cause(
                    key="carry_over", title="Zapas nie odbudował się po minionym sezonie",
                    text=f"Na koniec minionego sezonu ({fmt_date(previous.harvest - timedelta(days=1))}) w glebie brakowało "
                         f"{fmt(at_harvest)} mm wody. Od tego dnia spadło {fmt(rain_since)} mm opadu, a ubytek zmalał tylko do "
                         f"{fmt(status.result.depletion_mm)} mm: część opadu odparowała z powierzchni, zanim wsiąkła głębiej.",
                    evidence={"depletion_at_harvest_mm": round(at_harvest), "rain_since_mm": round(rain_since)}))

    not_assessed.append("Spadek terenu i skoncentrowany spływ: liczone osobno, wynik pojawia się w części o terenie.")
    reason = None
    if not items:
        reason = ("W danych nie ma czynników, które tłumaczyłyby niedobór: opad i parowanie mieszczą się "
                  "w zakresie typowym dla ostatnich 10 lat, a faza uprawy nie zwiększa zapotrzebowania.")
        if status.class_key in ("moderate", "severe"):
            reason = ("Bilans pokazuje niedobór, ale żaden z badanych czynników nie przekracza progu "
                      "(opad < 75% mediany, ET0 > 110% mediany, mała pojemność gleby, faza dużego zapotrzebowania). "
                      "Niedobór narastał stopniowo przez okres dłuższy niż 90 dni.")
    return CausesSection(status=Status.ok, reason=reason, windows=windows, items=items, not_assessed=not_assessed)


# ---------- raport ----------

def _no_weather_report(request: ReportRequest, parcel: uldk.Parcel | None, sources: list[SourceInfo],
                       started: float, timings: dict[str, float]) -> ReportResponse:
    reason = ("Żaden dostawca pogody nie odpowiedział. Bez opadu i ewapotranspiracji nie da się policzyć "
              "bilansu wodnego, więc oceny niedoboru wody nie ma. Spróbuj ponownie za kilka minut.")
    dependent = "Wymaga bilansu wodnego, a ten nie powstał z powodu braku pogody."
    crop = CROPS[request.crop.value]
    return ReportResponse(
        generated_at=datetime.now(timezone.utc), elapsed_s=round(time.perf_counter() - started, 2),
        request=request, analysis_date=request.date, parcel=_parcel_info(parcel) if parcel else None,
        crop=CropInfo(key=request.crop, name=crop.name, in_season=False),
        summary=[reason],
        water_status=WaterStatus(status=Status.error, reason=reason),
        satellite=SatelliteSection(status=Status.no_data, reason=NOT_CONNECTED),
        history=HistorySection(status=Status.no_data, reason=dependent),
        causes=CausesSection(status=Status.no_data, reason=dependent),
        soil=SoilSection(status=Status.no_data, reason=NOT_CONNECTED),
        terrain=TerrainRef(status=Status.no_data, reason=NOT_CONNECTED),
        hydrology=HydrologySection(status=Status.no_data, reason=NOT_CONNECTED),
        recommendations=Recommendations(
            status=Status.no_data,
            reason="Rekomendacje powstają dopiero po ocenie sytuacji wodnej, a tej nie udało się policzyć."),
        limitations=[reason], sources=sources, timings_s=timings)


async def build_report(request: ReportRequest, today: date | None = None) -> ReportResponse:
    started = time.perf_counter()
    today = today or today_warsaw()
    if request.date > today:
        raise HTTPException(status_code=422, detail="Data analizy nie może być z przyszłości.")
    if request.date < MIN_ANALYSIS_DATE:
        raise HTTPException(status_code=422, detail="Data analizy jest zbyt odległa (najwcześniej 01.01.2005).")
    crop = CROPS[request.crop.value]
    timings: dict[str, float] = {}

    # Ostatni dzień, który może wejść do obliczeń. Dla „dziś” jest to wczoraj (ostatnia pełna doba),
    # dla daty historycznej sama data. Nic późniejszego nie jest pobierane.
    end = request.date if request.date < today else today - timedelta(days=1)
    start = analysis.same_day_years_back(end, HISTORY_YEARS) - timedelta(days=WARMUP_DAYS)

    async with httpx.AsyncClient(headers={"User-Agent": USER_AGENT}, follow_redirects=True) as client:
        t0 = time.perf_counter()
        parcel, uldk_info = await resolve_parcel(client, request)
        timings["uldk"] = round(time.perf_counter() - t0, 2)
        lon, lat = parcel.centroid_lonlat if parcel else (request.point.lon, request.point.lat)

        t0 = time.perf_counter()
        (weather_result,) = await asyncio.gather(weather.fetch_weather(client, lat, lon, start, end, today))
        timings["weather"] = round(time.perf_counter() - t0, 2)

    sources = [uldk_info, *weather_sources(weather_result)]
    if weather_result.series is None or len(weather_result.series.dates) < 400:
        return _no_weather_report(request, parcel, sources, started, timings)

    t0 = time.perf_counter()
    soil_assumed = True
    variants = [assumed_variant()]
    sources.append(SourceInfo(
        key="soil", name="ISRIC SoilGrids 250 m", status=Status.no_data, reason=NOT_CONNECTED,
        impact="Bilans policzono dla gleby umownej (glina: 40% piasku, 20% iłu). Wynik jest orientacyjny."))

    computed = compute(weather_result.series, crop, variants)
    status = water_status(computed, soil_assumed)
    history = history_section(computed)
    causes = causes_section(computed, status, soil_assumed)
    timings["compute"] = round(time.perf_counter() - t0, 3)

    limitations = list(MODEL_LIMITATIONS)
    last = computed.dates[-1]
    if last < end:
        limitations.insert(0, f"Dane pogodowe kończą się {fmt_date(last)}, czyli {plural_days((end - last).days)} "
                              "przed ostatnim dniem analizy. Późniejszy opad nie jest uwzględniony.")
    if request.date >= today:
        limitations.insert(0, f"Analiza „na dziś” kończy się na ostatniej pełnej dobie ({fmt_date(end)}).")
    if soil_assumed:
        limitations.insert(0, "Brak danych o glebie: bilans policzono dla gleby umownej, wynik jest orientacyjny.")

    summary = [status.headline or ""]
    if status.text:
        summary.append(status.text[-1] if not computed.in_season else status.text[0])
    if status.uncertainty_text:
        summary.append(status.uncertainty_text)

    return ReportResponse(
        generated_at=datetime.now(timezone.utc), elapsed_s=round(time.perf_counter() - started, 2),
        request=request, analysis_date=request.date, parcel=_parcel_info(parcel) if parcel else None,
        crop=crop_info(computed, request.date), summary=summary,
        water_status=status,
        satellite=SatelliteSection(status=Status.no_data, reason=NOT_CONNECTED),
        history=history, causes=causes,
        soil=SoilSection(status=Status.no_data, reason=NOT_CONNECTED, assumed=True),
        terrain=TerrainRef(status=Status.no_data, reason=NOT_CONNECTED),
        hydrology=HydrologySection(status=Status.no_data, reason=NOT_CONNECTED),
        recommendations=Recommendations(status=Status.no_data, reason=NOT_CONNECTED),
        limitations=limitations, sources=sources, timings_s=timings)
