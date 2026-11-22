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
from urllib.parse import urlencode
from zoneinfo import ZoneInfo

import httpx
import numpy as np
from fastapi import HTTPException
from shapely.geometry import Point as ShapelyPoint

from app.config import HISTORY_YEARS, SATELLITE_INLINE_BUDGET_S, TIMEOUT_SOIL_TOTAL_S, USER_AGENT, WARMUP_DAYS
from app.core import analysis, satellite_logic
from app.core import hydrology as hydro_calc
from app.core import soil_moisture as moisture_calc
from app.core import recommendations as rules
from app.core.crops import (
    GROWTH_TEMP_THRESHOLD_C,
    STAGE_NAMES_PL,
    Crop,
    CropDaily,
    daily_crop_arrays,
    last_completed_season,
    root_depth_on,
    season_containing,
    season_for_harvest_year,
    sowing_after,
)
from app.core.ptf import USDA_LABELS_PL, usda_texture_class
from app.core.soil import SoilVariant, assumed_variant, build_variants, layer_water
from app.core.water_balance import (
    CLASS_KEYS,
    CLASS_LABELS_IN_SEASON,
    CLASS_LABELS_OFF_SEASON,
    BalanceResult,
    run_water_balance,
    total_available_water_mm,
    total_evaporable_water_mm,
)
from app.core.water_assessment import WaterAssessment, assess
from app.schemas import (
    BalanceVariant,
    Cause,
    CausesSection,
    ClimaticWaterBalance,
    CropInfo,
    CropParameter,
    DailyPoint,
    ForecastPoint,
    HistorySection,
    HydrologySection,
    HydroYear,
    IrrigationNeed,
    MlForecast,
    MlForecastPoint,
    MonthAmount,
    ParcelInfo,
    Point,
    Recommendation,
    Recommendations,
    ReportRequest,
    ReportResponse,
    NdmiForecast,
    SatelliteObservation,
    SatelliteSection,
    SeasonStress,
    SeasonSummary,
    SoilLayer,
    SoilMoistureLayer,
    SoilMoistureSection,
    SoilSection,
    SourceInfo,
    Status,
    TerrainRef,
    WaterStatus,
    WeatherWindow,
)
from app import terrain_service
from app.sources import NoData, SourceError, egib_wfs, imgw_hydro, mphp, parcels, sentinel, soilgrids, weather
from app.sources import soil_moisture as moisture_source
from app.sources import ifs_forecast
from app.textfmt import fmt, fmt_date, plural_days

WARSAW = ZoneInfo("Europe/Warsaw")
MIN_ANALYSIS_DATE = date(2005, 1, 1)
SERIES_DAYS_FOR_CHART = 365   # rok wstecz: wykres pokazuje ok. 4 miesiące, resztę odsłania przeciąganie
NOT_CONNECTED = "Tej części nie policzono, bo raport zatrzymał się na braku pogody."
HYDROLOGY_CHECK = ("Sprawdź na mapie i w terenie, czy przy działce jest ciek, rów albo oczko wodne. Jeśli tak, zostaw "
                   "wzdłuż brzegu pas trwałej roślinności.")
HYDROLOGY_IMPACT = ("Raport nie ocenia poziomu wody gruntowej: nie ma go w otwartych danych dla dowolnego punktu. "
                    "Odległość od cieku pochodzi z mapy MPHP10k w skali 1:10 000: drenażu podziemnego na niej nie ma, "
                    "a małe rowy mogą nie być zaznaczone. Stan rzeki z najbliższego wodowskazu IMGW opisuje całą zlewnię "
                    "powyżej niego (także wpływ zbiorników, zrzutów i poborów wody), a nie wodę w glebie działki.")
HYDRO_NO_IMPACT = ("Bilans wodny działki nie zależy od danych z wodowskazu: brakuje tylko niezależnej informacji, "
                   "czy w rzekach okolicy jest mało wody.")
TIMEOUT_HYDRO_TOTAL_S = 20.0
WATERCOURSE_SOURCE_NAME = "Mapa Podziału Hydrograficznego Polski MPHP10k (Wody Polskie, ISOK)"
WATERCOURSE_NO_IMPACT = ("Bez mapy cieków raport nie sprawdza, czy działka leży przy cieku, więc nie podpowie pasa "
                         "roślinności wzdłuż brzegu.")
TIMEOUT_WATERCOURSE_S = 20.0

MODEL_LIMITATIONS = [
    "Bilans nie uwzględnia spływu powierzchniowego: cały opad jest liczony jako woda, która wsiąka. "
    "Po ulewie i na stoku rzeczywisty zapas jest mniejszy.",
    "Bilans nie uwzględnia podsiąku z płytkiej wody gruntowej ani drenów. Na polach z wysokim "
    "poziomem wody gruntowej rzeczywisty niedobór jest mniejszy, niż pokazuje raport.",
    "Śnieg jest liczony jak deszcz w dniu opadu, a zamarznięcie gleby nie jest modelowane.",
    "Nawadnianie jest nieznane i nie wchodzi do bilansu. Jeśli pole było nawadniane, niedobór jest zawyżony.",
    "Pogoda pochodzi z siatki modelu, a nie z pomiaru na polu. Lokalna burza albo jej brak mogą "
    "zmienić wynik o kilkadziesiąt milimetrów.",
    "Długości faz rozwoju wynikają z kalendarza gatunku. Głębokość korzeni jest stała przez cały sezon.",
    "Współczynniki Kc pochodzą z tablic FAO-56 bez poprawki na lokalny wiatr i wilgotność powietrza.",
    "Porównanie z 10 latami zakłada, że co roku na polu rosła ta sama uprawa.",
]


def today_warsaw() -> date:
    return datetime.now(WARSAW).date()


# ---------- działka ----------

def _parcel_info(parcel: parcels.Parcel) -> ParcelInfo:
    lon, lat = parcel.centroid_lonlat
    minx, miny, maxx, maxy = parcel.geometry.bounds
    return ParcelInfo(
        id=parcel.id, number=parcel.number, region=parcel.region, commune=parcel.commune,
        county=parcel.county, voivodeship=parcel.voivodeship, area_ha=round(parcel.area_ha, 4),
        centroid=Point(lon=round(lon, 6), lat=round(lat, 6)), geometry=parcel.geojson(),
        bbox=[minx, miny, maxx, maxy])


async def resolve_parcel(client: httpx.AsyncClient, request: ReportRequest) -> tuple[parcels.Parcel | None, SourceInfo]:
    """Działka z ULDK. Przy awarii ULDK i podanym punkcie raport powstaje dla samego punktu."""
    t0 = time.perf_counter()
    info = SourceInfo(
        key="uldk", name="ULDK GUGiK (Usługa Lokalizacji Działek Katastralnych)", status=Status.ok,
        resolution="granica działki ewidencyjnej (wektor)", url="https://uldk.gugik.gov.pl/",
        license="dane państwowego zasobu geodezyjnego udostępniane bezpłatnie (szczegóły w README)",
        data_date="stan ewidencji w dniu pobrania")
    try:
        if request.parcel_id:
            parcel, from_cache = await parcels.get_parcel_by_id(client, request.parcel_id)
        else:
            parcel, from_cache = await parcels.get_parcel_by_point(client, request.point.lon, request.point.lat)
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
    if parcel.source == "egib_wfs":
        info.name = egib_wfs.SOURCE_NAME
        info.url = egib_wfs.WFS_URL
        info.reason = ("ULDK nie odpowiadało, więc granicę działki pobrano z zapasowej usługi GUGiK "
                       "(zbiorczy WFS ewidencji gruntów i budynków). Ta usługa nie podaje nazwy powiatu.")
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


# ---------- gleba ----------

SOIL_SOURCE_NAME = "ISRIC SoilGrids 250 m v2.0"
SOIL_ASSUMED_IMPACT = ("Bilans policzono dla gleby umownej (glina: 40% piasku, 20% iłu). Wynik jest orientacyjny, "
                       "a wpływu gleby na niedobór nie da się ocenić.")
HIGH_SOC_G_KG = 120.0  # powyżej tej zawartości węgla gleba może być organiczna (torfowa, murszowa)


async def fetch_soil_safe(client: httpx.AsyncClient, geometry) -> tuple[soilgrids.SoilData | None, SourceInfo]:
    """Gleba z SoilGrids z limitem czasu. Błąd nie przerywa raportu: wraca None i opis braku."""
    t0 = time.perf_counter()
    info = SourceInfo(
        key="soil", name=SOIL_SOURCE_NAME, status=Status.ok, resolution="siatka 250 m, sześć warstw do 200 cm",
        license="CC BY 4.0", url="https://www.isric.org/explore/soilgrids",
        data_date="mapa globalna z modelu (wersja 2.0, 2020), nie pomiar na polu")
    data: soilgrids.SoilData | None = None
    try:
        data = await asyncio.wait_for(soilgrids.fetch_soil(client, geometry), TIMEOUT_SOIL_TOTAL_S)
        info.from_cache = data.from_cache
        info.notes = [f"Sposób pobrania: {data.method_label}.", *data.notes,
                      *[f"Nieudana próba – {a}" for a in data.attempts]]
    except NoData as exc:
        info.status, info.reason, info.impact = Status.no_data, str(exc), SOIL_ASSUMED_IMPACT
    except asyncio.TimeoutError:
        info.status, info.impact = Status.error, SOIL_ASSUMED_IMPACT
        info.reason = f"SoilGrids nie odpowiedział w {TIMEOUT_SOIL_TOTAL_S:.0f} s."
    except (SourceError, RuntimeError) as exc:
        info.status, info.reason, info.impact = Status.error, str(exc), SOIL_ASSUMED_IMPACT
    info.elapsed_s = round(time.perf_counter() - t0, 2)
    return data, info


def soil_section(data: soilgrids.SoilData | None, info: SourceInfo, crop: Crop) -> SoilSection:
    if data is None:
        return SoilSection(status=info.status, reason=info.reason, assumed=True, root_depth_m=crop.root_depth_m,
                           text=[SOIL_ASSUMED_IMPACT])
    layers: list[SoilLayer] = []
    for layer in data.layers:
        usda = usda_texture_class(layer.sand_pct, layer.silt_pct, layer.clay_pct)
        label, image_key = USDA_LABELS_PL[usda]
        water = layer_water(layer.sand_pct, layer.clay_pct, layer.soc_g_kg)
        has_range = layer.sand_q05_pct is not None and layer.clay_q05_pct is not None
        layers.append(SoilLayer(
            top_cm=layer.top_cm, bottom_cm=layer.bottom_cm, sand_pct=round(layer.sand_pct, 1),
            silt_pct=round(layer.silt_pct, 1), clay_pct=round(layer.clay_pct, 1),
            soc_g_kg=round(layer.soc_g_kg, 1) if layer.soc_g_kg is not None else None,
            bulk_density_g_cm3=round(layer.bulk_density_g_cm3, 2) if layer.bulk_density_g_cm3 is not None else None,
            sand_pct_range=[round(layer.sand_q05_pct), round(layer.sand_q95_pct)] if has_range else None,
            clay_pct_range=[round(layer.clay_q05_pct), round(layer.clay_q95_pct)] if has_range else None,
            texture_key=image_key, texture_usda=usda, texture_label=label, image=f"/soil-assets/{image_key.replace('_', '-')}.webp",
            field_capacity_vol_pct=round(water.field_capacity * 100, 1),
            wilting_point_vol_pct=round(water.wilting_point * 100, 1),
            available_water_mm=round(water.available * layer.thickness_cm * 10.0)))
    top = layers[0]
    root_cm = crop.root_depth_m * 100
    root_water = sum(
        layer.available_water_mm * (min(layer.bottom_cm, root_cm) - layer.top_cm) / (layer.bottom_cm - layer.top_cm)
        for layer in layers if layer.top_cm < root_cm)
    text = [
        f"Wierzchnia warstwa to {top.texture_label} (piasek {fmt(top.sand_pct)}%, pył {fmt(top.silt_pct)}%, "
        f"ił {fmt(top.clay_pct)}%). W strefie korzeni do {fmt(crop.root_depth_m, 1)} m taka gleba może utrzymać "
        f"ok. {fmt(root_water)} mm wody dostępnej dla roślin.",
        f"Wartości pochodzą z mapy SoilGrids w siatce 250 m (liczba komórek pod działką: {data.cells}, średnia ważona "
        "powierzchnią). To szacunek z modelu globalnego: na pojedynczym polu gleba może być wyraźnie lżejsza albo "
        "cięższa, co pokazuje przedział 5–95%.",
    ]
    if any(layer.soc_g_kg is not None and layer.soc_g_kg > HIGH_SOC_G_KG for layer in layers[:3]):
        text.append("Mapa pokazuje bardzo dużo węgla organicznego: to może być gleba organiczna (torfowa lub murszowa). "
                    "Użyta funkcja przeliczeniowa dotyczy gleb mineralnych, więc pojemność wodna jest tu niepewna.")
    return SoilSection(status=Status.ok, assumed=False, cells=data.cells, method=data.method_label,
                       root_depth_m=crop.root_depth_m, layers=layers, text=text)


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
    assessments: dict[str, WaterAssessment]  # ocena w dniu analizy, pełna precyzja (zaokrąglenia tylko w raporcie)

    @property
    def main(self) -> BalanceResult:
        return self.balances[self.main_key]

    @property
    def assessment(self) -> WaterAssessment:
        return self.assessments[self.main_key]


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
                    in_field, in_season, tmean_10d, {key: assess(b) for key, b in balances.items()})


def variant_result(variant: SoilVariant, a: WaterAssessment, in_season: bool) -> BalanceVariant:
    """Prezentacja oceny jednego wariantu gleby: tu i tylko tu liczby są zaokrąglane."""
    labels = CLASS_LABELS_IN_SEASON if in_season else CLASS_LABELS_OFF_SEASON
    return BalanceVariant(
        key=variant.key, label=variant.label,
        field_capacity_vol_pct=round(variant.fc_root * 100, 1), wilting_point_vol_pct=round(variant.wp_root * 100, 1),
        taw_mm=round(a.taw_mm, 0), raw_mm=round(a.raw_mm, 0), depletion_mm=round(a.depletion_mm, 0),
        depletion_pct_taw=round(a.depletion_pct_taw, 0), available_mm=round(a.available_mm, 0), ks=round(a.ks, 2),
        class_key=a.class_key, class_label=labels[a.class_key])


def crop_info(c: Computed, request: ReportRequest) -> CropInfo:
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
    if season == crop.season_override:
        sowing_label = "Sadzenie" if crop.key == "potato" else "Siew"
        sowing_source = "podana data" if request.sowing_date is not None else "szacunek"
        harvest_source = "podana data" if request.harvest_date is not None else "szacunek"
        assumptions = [
            f"{sowing_label} {fmt_date(season.sowing)} ({sowing_source}), "
            f"zbiór {fmt_date(season.harvest - timedelta(days=1))} ({harvest_source}).",
            f"Wzorzec faz: {crop.sources['stages']}.",
            *crop.assumptions,
        ]
        if crop.next_sowing_date is not None:
            assumptions.insert(1, f"Kolejny siew {fmt_date(crop.next_sowing_date)} (podana data do oceny przerwy po zbiorze).")
    phase_bounds = (season.sowing, season.development_start, season.mid_start, season.late_start, season.harvest)
    if crop.perennial:
        assumptions.append("Użytek zielony jest uprawą trwałą: sezon liczony od 1 IV do 31 X.")
    assumptions.append(f"Głębokość korzeni pokazana w modelu rośnie liniowo od 0,15 m przy siewie do {fmt(crop.root_depth_m, 1)} m "
                       "na początku środka sezonu (FAO-56 rozdz. 8). Bilans wodny liczy stałą strefę korzeni "
                       f"{fmt(crop.root_depth_m, 1)} m przez cały sezon.")
    return CropInfo(
        key=crop.key, name=crop.name, in_season=c.in_season, stage_key=stage, stage_name=STAGE_NAMES_PL[stage],
        kc=round(kc, 2) if kc is not None else None, root_depth_m=crop.root_depth_m,
        root_depth_now_m=round(root_depth_on(crop, last), 2) if root_depth_on(crop, last) is not None else None,
        depletion_fraction_p=crop.p,
        season_from=season.sowing, season_to=season.harvest - timedelta(days=1),
        critical_from=season.critical_start, critical_to=season.critical_end - timedelta(days=1),
        parameters=[
            CropParameter(name="Współczynniki uprawy Kc (początek / środek / koniec sezonu)",
                          value=f"{fmt(crop.kc_ini, 2)} / {fmt(crop.kc_mid, 2)} / {fmt(crop.kc_end, 2)}",
                          source=crop.sources["kc"]),
            CropParameter(name="Głębokość korzeni Zr i frakcja p", value=f"{fmt(crop.root_depth_m, 1)} m; p = {fmt(crop.p, 2)}",
                          source=crop.sources["root"]),
            CropParameter(name="Długości faz [dni]",
                          value=" / ".join(str((end - start).days) for start, end in zip(phase_bounds, phase_bounds[1:])),
                          source=("Kalendarz gatunku dostosowany do terminów pola"
                                  if season == crop.season_override else crop.sources["stages"])),
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
        return (f"{crop.name} nie rośnie teraz na polu: według przyjętych terminów zbiór przypadał "
                f"{fmt_date(previous.harvest - timedelta(days=1))}, a kolejny siew {fmt_date(sowing_after(crop, previous))}.")
    season = season_containing(crop, last)
    sown = f"po siewie ({fmt_date(season.sowing)}) " if season and not crop.perennial else ""
    return (f"{crop.name} jest {sown}w polu, ale średnia temperatura z ostatnich 10 dni to "
            f"{fmt(c.tmean_10d_c, 1)} °C, poniżej progu wzrostu {fmt(GROWTH_TEMP_THRESHOLD_C, 0)} °C: "
            "rośliny praktycznie nie rosną i prawie nie pobierają wody.")


def water_status(c: Computed, soil_assumed: bool) -> WaterStatus:
    last = c.dates[-1]
    results = [variant_result(v, c.assessments[v.key], c.in_season) for v in c.variants]
    main = results[0]
    a = c.assessment  # porównania na pełnej precyzji, `main` tylko do wyświetlenia
    balance = c.main
    text: list[str] = []

    if c.in_season:
        headline = main.class_label
        text.append(
            f"Stan na {fmt_date(last)}: w strefie korzeni (do {fmt(c.crop.root_depth_m, 1)} m) brakuje "
            f"{fmt(a.depletion_mm)} mm wody do pełnego zapasu. Roślinom zostaje {fmt(a.available_mm)} mm "
            f"wody dostępnej z {fmt(a.taw_mm)} mm, które ta gleba może utrzymać (TAW).")
        if a.stressed:
            text.append(
                f"Wyczerpanie przekroczyło próg wody łatwo dostępnej (RAW = {fmt(a.raw_mm)} mm) o "
                f"{fmt(-a.margin_to_stress_mm)} mm. Rośliny pobierają wodę z trudem: zużycie spada do "
                f"ok. {fmt(a.ks * 100)}% potrzeb (współczynnik stresu Ks = {fmt(a.ks, 2)}).")
        else:
            sentence = (f"Do progu stresu (RAW = {fmt(a.raw_mm)} mm) zostaje {fmt(a.margin_to_stress_mm)} mm.")
            if a.days_to_stress is not None:
                sentence += (f" Przy zużyciu z ostatnich 7 dni ({fmt(a.etc_mm_day, 1)} mm na dobę) i bez opadu "
                             f"wystarczy to na ok. {plural_days(a.days_to_stress)}.")
            text.append(sentence)
    else:
        headline = "Uprawa nie jest w okresie wzrostu. " + main.class_label + "."
        text.append(_season_reason(c))
        text.append(
            f"Stan zapasu wody w glebie na {fmt_date(last)}: w warstwie do {fmt(c.crop.root_depth_m, 1)} m jest "
            f"{fmt(a.available_mm)} mm wody dostępnej dla roślin z {fmt(a.taw_mm)} mm możliwych "
            f"(brakuje {fmt(a.depletion_mm)} mm, czyli {fmt(a.depletion_pct_taw)}%).")

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
            f"Mapa gleb (SoilGrids, 250 m) nie zna dokładnie gleby na tym polu, więc bilans policzono też dla gleby "
            f"lżejszej i cięższej (przedział 5–95%). Strefa korzeni mieści wtedy od {fmt(min(r.taw_mm for r in results))} "
            f"do {fmt(max(r.taw_mm for r in results))} mm wody, a ubytek wynosi od {fmt(min(pcts))}% do {fmt(max(pcts))}% zapasu.")
        if spans:
            uncertainty += (f" Wynik zależy od gleby: od „{low.class_label}” do „{high.class_label}”. "
                            "Rozstrzygnie to sprawdzenie gleby na polu.")
        else:
            uncertainty += f" We wszystkich wariantach wynik jest ten sam: „{main.class_label}”."
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
    start = len(c.dates) - n
    available_pct = 100.0 * (1.0 - balance.depletion_mm / balance.taw_mm)
    band = analysis.typical_band(c.dates, available_pct, start, HISTORY_YEARS)
    series = [
        DailyPoint(date=c.dates[i], rain_mm=round(float(c.series.rain_mm[i]), 1), et0_mm=round(float(c.series.et0_mm[i]), 2),
                   etc_mm=round(float(balance.eta_mm[i]), 2), depletion_mm=round(float(balance.depletion_mm[i]), 1),
                   raw_mm=round(float(balance.raw_mm[i]), 1), taw_mm=round(float(balance.taw_mm), 1),
                   available_pct=round(float(available_pct[i]), 1),
                   stress_threshold_pct=round(100.0 * (1.0 - float(balance.raw_mm[i]) / balance.taw_mm), 1),
                   typical_p10_pct=round(band[i - start][0], 1) if band[i - start] else None,
                   typical_median_pct=round(band[i - start][1], 1) if band[i - start] else None,
                   typical_p90_pct=round(band[i - start][2], 1) if band[i - start] else None)
        for i in range(start, len(c.dates))]

    return WaterStatus(
        status=Status.ok, headline=headline, class_key=main.class_key, class_label=main.class_label,
        in_season=c.in_season, last_data_day=last, soil_assumed=soil_assumed, result=main, variants=results,
        spans_classes=spans, uncertainty_text=uncertainty, climatic_water_balance=cwb_model,
        last_season=last_season_model, series=series, text=text)


# ---------- historia ----------

def history_section(c: Computed) -> HistorySection:
    rows = analysis.seasons_history(c.dates, c.crop, c.crop_daily, c.main, HISTORY_YEARS)
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
        f"Ten sam bilans policzono dla {len(past)} sezonów do daty analizy, tak jakby co roku uprawiano tu to samo "
        f"({c.crop.name.lower()}). W okresie krytycznym dla plonu stres wodny wystąpił w {len(with_stress)} z {len(past)} sezonów."
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
        severe = [r for r in past if r["severe_days_critical"] >= SEVERE_SEASON_DAYS]
        text.append(
            f"Silny niedobór (wyczerpana ponad połowa wody trudno dostępnej) trwał co najmniej {SEVERE_SEASON_DAYS} dni "
            f"w {len(severe)} z {len(past)} sezonów" + (f": {', '.join(r['season'] for r in severe)}." if severe else "."))
    if current:
        text.append(
            f"Bieżący sezon {current['season']} (okres krytyczny trwa do {fmt_date(current['critical_to'])}): "
            f"dotąd {plural_days(current['stress_days_critical'])} stresu.")
    pct = 100.0 * c.main.depletion_mm / c.main.taw_mm if c.main.taw_mm > 0 else np.zeros(len(c.dates))
    same = analysis.same_day_comparison(c.dates, pct, HISTORY_YEARS)
    section = HistorySection(status=Status.ok, seasons=seasons, seasons_with_stress=len(with_stress),
                             seasons_with_long_stress=sum(1 for r in past if r["stress_days_critical"] >= LONG_STRESS_DAYS),
                             long_stress_days=LONG_STRESS_DAYS, seasons_total=len(past), text=text)
    # porównanie z tym samym dniem w poprzednich latach idzie w polach same_day_* (frontend pokazuje je osobno)
    if same:
        section.same_day_current_pct = round(same["current_pct"], 0)
        section.same_day_median_pct = round(same["median_pct"], 0)
        section.same_day_drier_years = same["drier_years"]
        section.same_day_years = same["years"]
    return section


# ---------- przyczyny ----------

RAIN_DEFICIT_PCT = 75.0     # opad poniżej tego odsetka mediany z 10 lat uznajemy za przyczynę
ET0_EXCESS_PCT = 110.0      # ET0 powyżej tego odsetka mediany z 10 lat uznajemy za przyczynę
MIN_DIFFERENCE_MM = 10.0    # i tylko wtedy, gdy różnica od mediany to co najmniej tyle milimetrów
LOW_AWC_M3_M3 = 0.10        # mniej niż 100 mm wody dostępnej na metr gleby = mała pojemność
LONG_STRESS_DAYS = 14       # „długi” stres w okresie krytycznym (do opisu historii)
SEVERE_SEASON_DAYS = 7      # tyle dni silnego niedoboru w okresie krytycznym wyróżnia sezon w opisie historii


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
    if not windows or windows[0].rain_median_mm is None:
        not_assessed.append("Porównanie opadu i ET0 z medianą 10 lat: seria pogodowa jest za krótka.")

    main_variant = c.variants[0]
    awc = main_variant.fc_root - main_variant.wp_root
    if soil_assumed:
        not_assessed.append("Pojemność wodna gleby: brak danych o glebie, przyjęto glebę umowną.")
    elif awc < LOW_AWC_M3_M3:
        items.append(Cause(
            key="low_soil_capacity", title="Mała pojemność wodna gleby",
            text=f"Gleba utrzymuje tylko {fmt(awc * 1000)} mm wody dostępnej dla roślin na każdy metr głębokości: "
                 f"po deszczu zatrzymuje wodę równą {fmt(main_variant.fc_root * 100)}% swojej objętości, a ostatnich "
                 f"{fmt(main_variant.wp_root * 100)}% korzenie już nie pobiorą. Zapas z opadów wyczerpuje się szybko "
                 "nawet przy przeciętnej pogodzie.",
            evidence={"available_mm_per_m": round(awc * 1000)}))

    kc = c.crop_daily.kc[-1]
    # w fazie dojrzewania Kc spada od wartości szczytowej, ale zapotrzebowanie przestaje decydować o plonie
    if c.in_season and c.crop_daily.stage[-1] in ("development", "mid") and np.isfinite(kc) and kc >= 1.0:
        etc = float(c.main.etc_mm[-7:].mean())
        items.append(Cause(
            key="high_demand_stage", title="Faza dużego zapotrzebowania uprawy",
            text=f"{c.crop.name} jest w fazie: {STAGE_NAMES_PL[c.crop_daily.stage[-1]]} i zużywa teraz średnio "
                 f"{fmt(etc, 1)} mm wody na dobę (średnia z 7 dni).",
            evidence={"kc": round(float(kc), 2), "etc_mm_day": round(etc, 1)}))

    # Niedobór przeniesiony z minionego sezonu: zapas nie odbudował się po zbiorze.
    stage = c.crop_daily.stage[-1]
    now = c.assessment
    if stage in ("off_season", "initial", "dormant") and now.depletion_mm > 0.5 * now.raw_mm:
        previous = last_completed_season(c.crop, c.dates[-1])
        i_harvest = analysis.index_of(c.dates, previous.harvest - timedelta(days=1))
        if i_harvest is not None and i_harvest < len(c.dates) - 1:
            at_harvest = float(c.main.depletion_mm[i_harvest])
            rain_since = float(c.series.rain_mm[i_harvest + 1:].sum())
            if at_harvest > now.depletion_mm * 0.5:
                items.append(Cause(
                    key="carry_over", title="Zapas nie odbudował się po minionym sezonie",
                    text=f"Na koniec minionego sezonu ({fmt_date(previous.harvest - timedelta(days=1))}) w glebie brakowało "
                         f"{fmt(at_harvest)} mm wody. Od tego dnia spadło {fmt(rain_since)} mm opadu, a ubytek zmalał tylko do "
                         f"{fmt(now.depletion_mm)} mm: część opadu odparowała z powierzchni, zanim wsiąkła głębiej.",
                    evidence={"depletion_at_harvest_mm": round(at_harvest), "rain_since_mm": round(rain_since)}))

    not_assessed.append("Spadek terenu i skoncentrowany spływ: liczone osobno, wynik pojawia się w części o terenie.")
    reason = None
    if not items:
        reason = ("W danych nie ma czynników, które tłumaczyłyby niedobór: opad i parowanie mieszczą się "
                  "w zakresie typowym dla ostatnich 10 lat, a faza uprawy nie zwiększa zapotrzebowania.")
        if status.class_key in ("moderate", "severe"):
            reason = ("Bilans pokazuje niedobór, ale żaden z badanych czynników nie przekracza progu "
                      "(opad poniżej 75% zwykłego, parowanie powyżej 110% zwykłego, mała pojemność gleby, "
                      "faza dużego zapotrzebowania). "
                      "Niedobór narastał stopniowo przez okres dłuższy niż 90 dni.")
    return CausesSection(status=Status.ok, reason=reason, windows=windows, items=items, not_assessed=not_assessed)


# ---------- satelita ----------

SATELLITE_SOURCE_NAME = "Sentinel-2 L2A (Copernicus) przez Earth Search STAC (Element 84)"
SATELLITE_NO_IMPACT = ("Bilans wodny nie zależy od zdjęć: brakuje tylko niezależnego potwierdzenia, "
                       "czy rośliny reagują tak, jak pokazuje bilans.")


def satellite_endpoint(request: ReportRequest, parcel_id: str) -> str:
    query = request.model_dump(mode="json", exclude_none=True, exclude={"point"})
    return "/api/satellite?" + urlencode({**query, "parcel_id": parcel_id})


async def finish_satellite(task: asyncio.Task | None, started_at: float) -> tuple[sentinel.SatelliteResult | None, SourceInfo]:
    """Odbiera wynik zadania satelitarnego. Błąd nie przerywa raportu."""
    info = SourceInfo(
        key="satellite", name=SATELLITE_SOURCE_NAME, status=Status.ok,
        resolution="piksel 20 m (B8A, B11, maska SCL); B04 z 10 m uśrednione do 20 m",
        license="dane Copernicus Sentinel: dostęp bezpłatny, pełny i otwarty",
        url="https://earth-search.aws.element84.com/v1")
    if task is None:
        info.status, info.impact = Status.no_data, SATELLITE_NO_IMPACT
        info.reason = "Brak granicy działki (raport dla punktu), więc nie ma czego wyciąć ze zdjęć."
        return None, info
    result: sentinel.SatelliteResult | None = None
    try:
        result = await task
        info.data_from, info.data_to = result.window_from, result.window_to
        info.from_cache = result.cached_observations == result.scenes_found and result.scenes_found > 0
        info.notes = [f"Sceny w oknie 45 dni: {result.scenes_found}. Czas: szukanie {fmt(result.timings_s.get('search', 0), 1)} s, "
                      f"maski chmur {fmt(result.timings_s.get('scl', 0), 1)} s, pasma {fmt(result.timings_s.get('bands', 0), 1)} s.",
                      *result.notes]
    except (SourceError, NoData) as exc:
        info.status, info.reason, info.impact = Status.error, str(exc), SATELLITE_NO_IMPACT
    except Exception as exc:  # odczyt rastrów w wątku może zgłosić dowolny wyjątek biblioteki
        info.status, info.impact = Status.error, SATELLITE_NO_IMPACT
        info.reason = f"Błąd odczytu zdjęć satelitarnych ({type(exc).__name__})."
    info.elapsed_s = round(time.perf_counter() - started_at, 2)
    return result, info


def signed(value: float) -> str:
    """Liczba ze znakiem i polskim przecinkiem, 2 miejsca (dokładność NDMI)."""
    text = fmt(value, 2)
    return text if text.startswith("-") or text == "0,00" else "+" + text


def ndmi_forecast(result: sentinel.SatelliteResult, c: Computed, analysis_date: date,
                  location: tuple[float, float] | None = None) -> NdmiForecast | None:
    """Prognoza zmiany NDMI na 7–14 dni (kowr_ml). Model jest dodatkiem: błąd albo brak modelu nie psuje raportu.

    location – (lat, lon) środka działki w EPSG:4326; model używa położenia jako cechy.
    """
    try:
        from kowr_ml import predict as ml_predict
        if not ml_predict.in_season(analysis_date):
            return None
        lat, lon = location if location else (None, None)
        out = ml_predict.predict(result.observations, c.series, analysis_date, lat=lat, lon=lon)
    except Exception as exc:  # brak scikit-learn, uszkodzony plik modelu itp.
        return NdmiForecast(available=False, reason=f"moduł prognozy niedostępny ({type(exc).__name__})")
    fc = NdmiForecast(**out)
    if not fc.available:
        return fc
    lo, mid, hi = fc.delta_p10, fc.delta_p50, fc.delta_p90
    if mid <= -satellite_logic.NDMI_DROP:
        fc.trend, trend = "down", "prawdopodobnie spadnie"
    elif mid >= satellite_logic.NDMI_DROP:
        fc.trend, trend = "up", "prawdopodobnie wzrośnie"
    else:
        # Gdy model nie wskazuje kierunku, NDMI i tak zwykle się zmienia: zmiana poniżej progu zdarzyła się
        # w 40% takich przypadków na danych niezależnych (README, „Model ML”). Dlatego nie piszemy „nie zmieni się”.
        fc.trend, trend = "flat", "może zmienić się w obie strony"
    fc.text.append(
        f"Prognoza modelu ({fc.status}): w dniach {fmt_date(fc.window_from)}–{fmt_date(fc.window_to)} uwilgotnienie roślin "
        f"(NDMI) {trend} względem zdjęcia z {fmt_date(fc.last_scene_date)}: zmiana {signed(mid)}, "
        f"przedział 80% od {signed(lo)} do {signed(hi)}.")
    # Model uczono na pogodzie z archiwum Open-Meteo; inny dostawca w oknie cech (30 dni) to inne dane wejściowe.
    recent_origin = [o for d, o in zip(c.series.dates, c.series.origin) if analysis_date - timedelta(days=30) <= d < analysis_date]
    if recent_origin and any(o == "nasa_power" for o in recent_origin):
        fc.text.append("Pogoda z ostatnich 30 dni pochodzi z NASA POWER, a model uczono na danych Open-Meteo, "
                       "więc prognoza jest mniej pewna niż zwykle.")
    if lo < 0 < hi and (hi - lo) > 2 * satellite_logic.NDMI_DROP:
        fc.text.append("Przedział obejmuje zarówno spadek, jak i wzrost, więc kierunek zmiany jest niepewny.")
    fc.text.append("To prognoza wskaźnika satelitarnego, nie wilgotności gleby. Nie wylicza się z niej dawki nawodnienia; "
                   "może wskazać, kiedy warto obejrzeć pole.")
    return fc


def satellite_section(result: sentinel.SatelliteResult | None, info: SourceInfo, c: Computed, class_key: str,
                      request: ReportRequest, parcel_id: str | None,
                      location: tuple[float, float] | None = None) -> tuple[SatelliteSection, bool]:
    """Sekcja satelitarna i informacja, czy rozbieżność z bilansem uzasadnia oględziny pola."""
    if result is None:
        return SatelliteSection(status=info.status, reason=info.reason, text=[SATELLITE_NO_IMPACT]), False
    observations = [SatelliteObservation(
        scene_id=o.scene_id, date=date.fromisoformat(o.date), valid_pixels=o.valid_pixels, total_pixels=o.total_pixels,
        coverage_pct=round(100 * o.coverage, 0), bare_pixels=o.bare_pixels, cloudy_pixels=o.cloudy_pixels,
        accepted=o.accepted and o.ndmi is not None, reject_reason=o.reject_reason,
        ndvi=round(o.ndvi, 3) if o.ndvi is not None else None, ndmi=round(o.ndmi, 3) if o.ndmi is not None else None)
        for o in result.observations]
    section = SatelliteSection(status=Status.ok, window_from=result.window_from, window_to=result.window_to,
                               scenes_found=result.scenes_found, observations=observations)
    used = [o for o in observations if o.accepted]
    pending = result.unfinished > 0

    # co pokazuje najnowsze czyste zdjęcie: zieloną okrywę czy odkrytą glebę
    clear = [o for o in observations if o.total_pixels and (o.valid_pixels + o.bare_pixels) >= 0.65 * o.total_pixels]
    if clear:
        newest = clear[-1]
        section.green_cover = newest.valid_pixels >= newest.bare_pixels
    too_small = observations and all(o.total_pixels < sentinel.MIN_PIXELS for o in observations)

    if used:
        assessment = satellite_logic.assess(
            [satellite_logic.IndexPoint(o.date, o.ndvi, o.ndmi) for o in used], request.date, c.in_season,
            c.crop_daily.stage[-1], class_key, c.crop.name)
        section.latest = used[-1]
        section.agreement = assessment.agreement
        section.ndmi_change = round(assessment.ndmi_change, 3) if assessment.ndmi_change is not None else None
        section.ndvi_change = round(assessment.ndvi_change, 3) if assessment.ndvi_change is not None else None
        section.text = assessment.text
        field_check = assessment.field_check
    else:
        field_check = False
        section.agreement = "inconclusive"
        if too_small:
            section.status = Status.no_data
            section.reason = (f"Działka jest za mała albo za wąska dla Sentinel-2: mieści {observations[0].total_pixels} "
                              f"środków pikseli 20 m, a potrzeba co najmniej {sentinel.MIN_PIXELS}.")
        elif not observations:
            section.status = Status.no_data
            section.reason = (f"W oknie {fmt_date(result.window_from)}–{fmt_date(result.window_to)} nie ma zdjęć Sentinel-2 "
                              "dla tej działki (archiwum L2A zaczyna się w 2017 r.).")
        elif not pending:
            cloudy = sum(1 for o in observations if o.reject_reason and "chmury" in o.reject_reason)
            bare = sum(1 for o in observations if o.reject_reason and "brak zielonej roślinności" in o.reject_reason)
            section.status = Status.no_data
            section.reason = (f"W oknie 45 dni przed datą było {len(observations)} zdjęć, ale żadne nie pokazuje czystej "
                              f"roślinności na działce: {cloudy} z chmurami, {bare} bez zielonej roślinności, "
                              f"{len(observations) - cloudy - bare} z innych powodów.")
            if bare and section.green_cover is False:
                newest_bare = max(o.date for o in observations if o.reject_reason and "brak zielonej roślinności" in o.reject_reason)
                section.text.append(
                    f"Najnowsze czyste zdjęcie ({fmt_date(newest_bare)}) pokazuje pole bez zielonej roślinności: odkrytą glebę, "
                    "resztki albo zaschnięte, dojrzałe rośliny. Wskaźniki roślinne nie mają wtedy zastosowania.")
        if section.status != Status.ok:
            section.text.append(SATELLITE_NO_IMPACT)

    if pending and parcel_id:
        section.status = Status.pending
        section.endpoint = satellite_endpoint(request, parcel_id)
        section.reason = (f"Część zdjęć jeszcze się wczytuje ({result.unfinished} scen; łącze do archiwum zdjęć jest wolne). "
                          "Wynik uzupełni się sam, zwykle w ciągu minuty.")
    section.ndmi_forecast = ndmi_forecast(result, c, request.date, location)
    if not c.in_season and section.green_cover is True and c.crop_daily.stage[-1] == "off_season":
        section.text.append("Na polu widać zieloną okrywę, choć według kalendarza wybranej uprawy pole powinno być puste. "
                            "To może być międzyplon, samosiewy albo inna uprawa niż wybrana. Okrywa ogranicza spływ "
                            "i parowanie, więc warto ją utrzymać do wiosny.")
    return section, field_check


# ---------- zapotrzebowanie na nawadnianie ----------

IRRIGATION_DOSE_MM = 25.0   # założona dawka jednego nawadniania (założenie projektowe, do zmiany przy znanej instalacji)


def _count(n: int, one: str, few: str, many: str) -> str:
    return f"{n} {one if n == 1 else few if n % 10 in (2, 3, 4) and n % 100 not in (12, 13, 14) else many}"


def irrigation_need_section(c: Computed) -> IrrigationNeed:
    variant = c.variants[0]
    irrigated = run_water_balance(
        c.series.rain_mm, c.series.et0_mm, c.crop_daily.kc, c.crop_daily.in_field, taw_mm=c.main.taw_mm, p_table=c.crop.p,
        tew_mm=total_evaporable_water_mm(variant.fc_top, variant.wp_top), rew_mm=variant.rew_mm, refill_at_raw=True,
        dose_mm=IRRIGATION_DOSE_MM)
    need = analysis.irrigation_need(c.dates, c.crop, c.crop_daily, irrigated, c.series.rain_mm, HISTORY_YEARS)
    if not need or (need.get("current_label") is None and "typical_mm" not in need):
        return IrrigationNeed(status=Status.no_data, reason="Za mało pełnych sezonów w danych, żeby policzyć zapotrzebowanie.")
    text = []
    if need.get("current_label") is not None:
        text.append(f"W tym sezonie (od {fmt_date(need['season_from'])}) utrzymanie zapasu powyżej progu stresu wymagałoby "
                    f"{fmt(need['so_far_mm'])} mm wody ({_count(need['so_far_events'], 'dawka', 'dawki', 'dawek')} po {fmt(IRRIGATION_DOSE_MM)} mm). Uprawa zużyła w tym czasie ok. "
                    f"{fmt(need['etc_so_far_mm'])} mm, a spadło {fmt(need['rain_so_far_mm'])} mm deszczu.")
    if "typical_mm" in need:
        text.append(f"W typowym sezonie z ostatnich {need['seasons']} lat potrzeba {fmt(need['typical_mm'])} mm, w suchym "
                    f"(co dziesiąty rok) {fmt(need['dry_mm'])} mm. "
                    + (f"Bez potrzeby nawadniania: {_count(need['seasons_without'], 'sezon', 'sezony', 'sezonów')}." if need['seasons_without'] else ""))
    text.append(f"To ilość netto, która ma trafić do gleby: dawka {fmt(IRRIGATION_DOSE_MM)} mm, gdy zapas spada poniżej progu "
                "stresu. Do wydajności instalacji trzeba doliczyć jej straty; wynik dotyczy przyjętego kalendarza uprawy i gleby "
                "z SoilGrids.")
    return IrrigationNeed(
        status=Status.ok, season_label=need.get("current_label"), season_from=need.get("season_from"),
        so_far_mm=round(need["so_far_mm"]) if "so_far_mm" in need else None, so_far_events=need.get("so_far_events"),
        etc_so_far_mm=round(need["etc_so_far_mm"]) if "etc_so_far_mm" in need else None,
        rain_so_far_mm=round(need["rain_so_far_mm"]) if "rain_so_far_mm" in need else None,
        typical_mm=round(need["typical_mm"]) if "typical_mm" in need else None,
        dry_mm=round(need["dry_mm"]) if "dry_mm" in need else None, seasons_compared=need["seasons"],
        seasons_without=need.get("seasons_without", 0),
        dose_mm=round(need["dose_mm"]) if need.get("dose_mm") else None,
        monthly=[MonthAmount(month=m, mm=round(v, 1)) for m, v in need.get("monthly", [])], text=text)


# ---------- prognoza zapasu wody ----------

async def fetch_forecast_safe(client: httpx.AsyncClient, lat: float, lon: float, today: date):
    """Prognoza Open-Meteo do 16 dni; błąd zwraca powód zamiast przerywać raport."""
    try:
        return await weather.fetch_dashboard_forecast(client, lat, lon, today, days=weather.FORECAST_MAX_DAYS), None
    except (NoData, SourceError) as exc:
        return None, f"Brak prognozy pogody: {exc}"


async def fetch_ifs_safe(client: httpx.AsyncClient, lat: float, lon: float, today: date):
    """Prognoza ECMWF IFS (wejście modelu wilgotności); błąd zwraca powód zamiast przerywać raport."""
    try:
        return (await ifs_forecast.fetch(client, lat, lon, today))[0], None
    except (NoData, SourceError) as exc:
        return None, f"Brak prognozy ECMWF IFS: {exc}"


def ml_forecast(c: Computed, soil_layers, ifs, ifs_reason: str | None, today: date) -> MlForecast | None:
    """Zapas działki na dni t … t+13 modelem wilgotności v3 (kowr_ml.sm_predict).

    Model daje zmianę wilgotności 0–100 cm od ostatniej doby bilansu (t−1). Zmianę przeliczamy na mm wody w strefie
    korzeni (do 1 m, bo tyle obejmuje etykieta) i doczepiamy do zapasu działki z bilansu FAO-56 z tej doby.
    Model jest dodatkiem: brak danych albo błąd daje powód, a raport liczy się dalej.
    """
    if ifs is None:
        return MlForecast(available=False, reason=ifs_reason) if ifs_reason else None
    taw = c.main.taw_mm
    if taw <= 0:
        return MlForecast(available=False, reason="zerowa pojemność wodna strefy korzeni")
    try:
        from kowr_ml import sm_predict
        out = sm_predict.predict(c.series, ifs, soil_layers, today)
    except Exception as exc:  # brak scikit-learn, uszkodzony plik modelu itp.
        return MlForecast(available=False, reason=f"moduł prognozy niedostępny ({type(exc).__name__})")
    if not out["available"]:
        return MlForecast(available=False, reason=out["reason"])
    start = 100.0 * (1.0 - float(c.main.depletion_mm[-1]) / taw)
    scale = 100.0 * 1000.0 * min(c.crop.root_depth_m, 1.0) / taw   # Δθ [m3/m3] -> % TAW działki

    def pct(delta: float) -> float:
        return round(min(max(start + scale * delta, 0.0), 100.0), 1)

    points = [MlForecastPoint(date=p["date"], available_pct=pct(p["delta_p50"]), low_pct=pct(p["delta_p10"]),
                              high_pct=pct(p["delta_p90"])) for p in out["points"]]
    text = [f"Prognoza modelu uczenia maszynowego ({out['status']}) na {plural_days(len(points))}: zmiana wilgotności gleby "
            f"0–100 cm z modelu uczonego na reanalizie ERA5-Land i prognozie ECMWF IFS, doczepiona do zapasu działki "
            f"z {fmt_date(c.dates[-1])}. Pas wokół linii to przedział 80%."]
    coverage = out.get("interval_coverage_test")
    if coverage is not None and coverage < 0.78:
        text.append(f"W teście na sezonie 2025 ten przedział obejmował {fmt(100 * coverage)}% obserwacji, "
                    + ("czyli jest nieco za wąski." if coverage >= 0.72
                       else "czyli jest za wąski: rzeczywista zmiana częściej wypada poza pas, zwłaszcza w dalszych dniach."))
    recent = [o for d, o in zip(c.series.dates, c.series.origin) if today - timedelta(days=30) <= d < today]
    if any(o == "nasa_power" for o in recent):
        text.append("Pogoda z ostatnich 30 dni pochodzi z NASA POWER, a model uczono na reanalizie ERA5, "
                    "więc prognoza jest mniej pewna niż zwykle.")
    return MlForecast(available=True, model_run=out["model_run"], model_status=out["status"], points=points, text=text)


def project_forecast(status: WaterStatus, c: Computed, forecast) -> None:
    """Bilans puszczony dalej po prognozie: ten sam model i parametry co dla minionych dni."""
    if forecast is None:
        return
    last = c.dates[-1]
    days = [d for d in forecast.days if d.date > last and d.precipitation_mm is not None and d.et0_mm is not None]
    if not days or days[0].date != last + timedelta(days=1):
        status.forecast_reason = (f"Prognoza zaczyna się później niż ostatni dzień bilansu ({fmt_date(last)}), "
                                  "więc nie da się jej dołączyć bez luki.")
        return
    # tyle dni, ile prognozy modelu AI (ifs_forecast.DAYS), żeby obie linie na wykresie kończyły się razem
    days = [d for i, d in enumerate(days) if d.date == days[0].date + timedelta(days=i)][:ifs_forecast.DAYS]
    variant = c.variants[0]
    crop_daily = daily_crop_arrays(c.crop, [d.date for d in days])
    taw = c.main.taw_mm
    result = run_water_balance(
        np.array([d.precipitation_mm for d in days]), np.array([d.et0_mm for d in days]), crop_daily.kc, crop_daily.in_field,
        taw_mm=taw, p_table=c.crop.p, tew_mm=total_evaporable_water_mm(variant.fc_top, variant.wp_top),
        rew_mm=variant.rew_mm, initial_depletion_mm=float(c.main.depletion_mm[-1]))
    # „typowo” na dni prognozy: te same dni w 10 poprzednich latach bilansu, jak dla przebiegu dziennego
    band = analysis.typical_for(c.dates, 100.0 * (1.0 - c.main.depletion_mm / taw), [d.date for d in days], HISTORY_YEARS)
    for i, d in enumerate(days):
        available = 100.0 * (1.0 - result.depletion_mm[i] / taw)
        threshold = 100.0 * (1.0 - result.raw_mm[i] / taw)
        p10, p50, p90 = (round(v, 1) for v in band[i]) if band[i] else (None, None, None)
        status.forecast.append(ForecastPoint(date=d.date, rain_mm=round(d.precipitation_mm, 1), et0_mm=round(d.et0_mm, 2),
                                             available_pct=round(available, 1), stress_threshold_pct=round(threshold, 1),
                                             typical_p10_pct=p10, typical_median_pct=p50, typical_p90_pct=p90))
        if status.forecast_stress_day is None and crop_daily.in_field[i] and available < threshold:
            status.forecast_stress_day = d.date


# ---------- wilgotność gleby w warstwach (okolica) ----------

MOISTURE_NO_IMPACT = ("Bilans wodny działki nie zależy od tych danych: brakuje tylko niezależnego porównania wilgotności "
                      "warstw gleby w okolicy z poprzednimi latami.")


async def fetch_moisture_safe(client: httpx.AsyncClient, lat: float, lon: float, start: date, end: date
                              ) -> tuple[dict | None, SourceInfo]:
    """Serie wilgotności warstw z NASA POWER z limitem czasu. Błąd nie przerywa raportu."""
    t0 = time.perf_counter()
    info = SourceInfo(key="soil_moisture", name=moisture_source.SOURCE_NAME, status=Status.ok,
                      resolution=moisture_source.RESOLUTION, license=moisture_source.LICENSE, url=moisture_source.URL)
    series = None
    try:
        series, info.from_cache = await moisture_source.fetch(client, lat, lon, start, end)
        days = [d for values in series.values() for d in values]
        info.data_from, info.data_to = min(days), max(days)
    except NoData as exc:
        info.status, info.reason, info.impact = Status.no_data, str(exc), MOISTURE_NO_IMPACT
    except (SourceError, RuntimeError) as exc:
        info.status, info.reason, info.impact = Status.error, str(exc), MOISTURE_NO_IMPACT
    info.elapsed_s = round(time.perf_counter() - t0, 2)
    return series, info


def soil_moisture_section(series: dict | None, info: SourceInfo, end: date, balance_class: str | None
                          ) -> SoilMoistureSection:
    if series is None:
        return SoilMoistureSection(status=info.status, reason=info.reason, text=[MOISTURE_NO_IMPACT])
    layers = moisture_calc.compare_layers(series, end, HISTORY_YEARS)
    if not layers:
        reason = "Za mało lat z danymi o wilgotności warstw, żeby porównać je z poprzednimi latami."
        return SoilMoistureSection(status=Status.no_data, reason=reason, text=[MOISTURE_NO_IMPACT])
    out = [SoilMoistureLayer(
        key=layer.key, label=layer.label, top_cm=layer.top_cm, bottom_cm=layer.bottom_cm,
        current=round(layer.comparison.current, 3), current_to=layer.current_to,
        median=round(layer.comparison.median, 3), years_higher=layer.comparison.years_higher,
        years_compared=layer.comparison.years_compared, class_key=layer.comparison.class_key,
        class_label=moisture_calc.CLASS_LABELS[layer.comparison.class_key]) for layer in layers]
    text = [f"{layer.label.capitalize()}: {layer.class_label} (wilgotniej było w {layer.years_higher} z "
            f"{layer.years_compared} poprzednich lat)." for layer in out]
    agreement = moisture_calc.agreement_with_balance(layers, balance_class)
    if agreement:
        text.append(agreement)
    last = max(layer.current_to for layer in out)
    if last < end:
        text.append(f"Dane modelu kończą się {fmt_date(last)}, {plural_days((end - last).days)} przed ostatnim dniem analizy.")
    text.append("To model regionalny w siatce ok. 50 km: opisuje okolicę, a nie samą działkę. Wilgotność na działce "
                "liczy bilans wodny powyżej.")
    return SoilMoistureSection(status=Status.ok, layers=out, text=text)


# ---------- hydrologia ----------

HYDRO_SOURCE_NAME = "IMGW-PIB: wodowskazy (API danych publicznych i archiwum danych dobowych)"


async def fetch_hydrology_safe(client: httpx.AsyncClient, lon: float, lat: float, analysis_date: date,
                               today: date) -> tuple[imgw_hydro.HydroResult | None, SourceInfo]:
    """Najbliższy wodowskaz z limitem czasu. Błąd nie przerywa raportu."""
    t0 = time.perf_counter()
    info = SourceInfo(
        key="hydrology", name=HYDRO_SOURCE_NAME, status=Status.ok,
        resolution=f"pomiar na wodowskazie (najbliższy w promieniu {imgw_hydro.MAX_DISTANCE_KM:.0f} km od działki)",
        license="dane IMGW-PIB, bezpłatne z obowiązkiem podania źródła (szczegóły w README)",
        url="https://danepubliczne.imgw.pl/", notes=[imgw_hydro.ATTRIBUTION])
    result = None
    try:
        result = await asyncio.wait_for(
            imgw_hydro.fetch_hydrology(client, lon, lat, analysis_date, today, HISTORY_YEARS), TIMEOUT_HYDRO_TOTAL_S)
        info.from_cache = result.from_cache
        info.resolution = (f"wodowskaz {result.station.name} ({_river_name(result.station.river)}), "
                           f"{fmt(result.station.distance_km)} km od działki")
        years = [y for y, _ in result.comparison.years]
        info.data_from = date(min(years), 1, 1) if years else None
        info.data_to = result.current_to
        info.data_date = ("bieżący pomiar z " + fmt_date(result.current_to) if result.origin == "live"
                          else f"archiwum dobowe do {fmt_date(result.archive_to)}" if result.archive_to else None)
        info.notes += result.notes
    except NoData as exc:
        info.status, info.reason, info.impact = Status.no_data, str(exc), HYDRO_NO_IMPACT
    except asyncio.TimeoutError:
        info.status, info.impact = Status.error, HYDRO_NO_IMPACT
        info.reason = f"Dane IMGW nie przyszły w {TIMEOUT_HYDRO_TOTAL_S:.0f} s."
    except (SourceError, RuntimeError) as exc:
        info.status, info.reason, info.impact = Status.error, str(exc), HYDRO_NO_IMPACT
    info.elapsed_s = round(time.perf_counter() - t0, 2)
    return result, info


async def fetch_watercourse_safe(client: httpx.AsyncClient,
                                 geometry) -> tuple[mphp.Watercourse | None, SourceInfo]:
    """Najbliższy ciek z mapy MPHP10k z limitem czasu. Błąd nie przerywa raportu."""
    t0 = time.perf_counter()
    info = SourceInfo(
        key="watercourses", name=WATERCOURSE_SOURCE_NAME, status=Status.ok,
        resolution=f"skala 1:10 000, cieki do {fmt(mphp.SEARCH_RADIUS_M)} m od działki",
        url="https://isok.gov.pl/inspire.html",
        license="usługa WMS: brak warunków dostępu i użytkowania; zbiór na dane.gov.pl: CC BY 4.0",
        notes=["Geometria cieków z publicznej usługi WMS (zapytanie GetFeatureInfo), bez logowania."])
    result = None
    try:
        result, info.from_cache = await asyncio.wait_for(
            mphp.fetch_nearest_watercourse(client, geometry), TIMEOUT_WATERCOURSE_S)
    except asyncio.TimeoutError:
        info.status, info.impact = Status.error, WATERCOURSE_NO_IMPACT
        info.reason = f"Mapa cieków nie odpowiedziała w {TIMEOUT_WATERCOURSE_S:.0f} s."
    except (SourceError, RuntimeError) as exc:
        info.status, info.reason, info.impact = Status.error, str(exc), WATERCOURSE_NO_IMPACT
    info.elapsed_s = round(time.perf_counter() - t0, 2)
    return result, info


def add_watercourse(hydro: HydrologySection, watercourse: mphp.Watercourse | None, info: SourceInfo,
                    is_point: bool) -> None:
    """Dopisuje do sekcji hydrologii najbliższy ciek z mapy MPHP10k albo to, że w promieniu wyszukiwania go nie ma."""
    if info.status != Status.ok:
        hydro.text.append(HYDROLOGY_CHECK)   # bez mapy cieków rolnik musi to sprawdzić sam
        return
    edge = "od wskazanego punktu" if is_point else "od granicy działki"
    hydro.search_radius_m = mphp.SEARCH_RADIUS_M
    if watercourse is None:
        hydro.text.insert(0, f"Na mapie cieków MPHP10k nie ma cieku bliżej niż {fmt(mphp.SEARCH_RADIUS_M)} m {edge}.")
        return
    distance_m = round(watercourse.distance_m, -1)   # mapa 1:10 000, linie uproszczone do ok. 8 m
    hydro.nearest_watercourse_name = watercourse.name
    hydro.nearest_watercourse_distance_m = distance_m
    name = watercourse.name or "bez nazwy"
    where = ("przecina działkę albo biegnie jej granicą" if distance_m == 0 and not is_point
             else f"jest ok. {fmt(distance_m)} m {edge}")
    hydro.text.insert(0, f"Najbliższy ciek na mapie MPHP10k ({name}) {where}.")


def _river_name(river: str) -> str:
    """„Bystrzyca (246)” → „Bystrzyca” (w nawiasie jest kod IMGW, rolnikowi niepotrzebny)."""
    return river.split(" (")[0].strip() if river else river


def hydrology_section(result: imgw_hydro.HydroResult | None, info: SourceInfo, class_key: str | None,
                      in_season: bool) -> HydrologySection:
    if result is None:
        return HydrologySection(status=info.status, reason=info.reason, text=[HYDRO_NO_IMPACT])
    s, cmp = result.station, result.comparison
    river = _river_name(s.river)
    # Stacja, pomiar, mediana i porównanie z latami są na kafelkach i w tabeli; w tekście tylko to, co z tego wynika
    # dla pola. Zastrzeżenia metodyczne idą do źródła (notes) i do „Czego nie wiemy” (HYDROLOGY_IMPACT).
    text = [hydro_calc.agreement_with_balance(cmp.class_key, class_key, in_season)]
    if result.origin == "live":
        info.notes.append("Bieżący pomiar to pojedynczy odczyt, a lata odniesienia to średnie z 7 dni z archiwum IMGW "
                          "(opublikowane do " + fmt_date(result.archive_to) + ").")
    if result.metric == "level":
        info.notes.append("Ten wodowskaz nie ma opracowanego przepływu, więc porównano stan wody; jest on mniej "
                          "porównywalny między latami (zmiany koryta i wodowskazu).")
    return HydrologySection(
        status=Status.ok, station_id=s.id, station_name=s.name, river=river, station_distance_km=round(s.distance_km, 1),
        station_location=Point(lon=s.lon, lat=s.lat), metric=result.metric, unit=result.unit, origin=result.origin,
        current_value=round(cmp.current, 3), current_from=result.current_from, current_to=result.current_to,
        years=[HydroYear(year=y, value=round(v, 3)) for y, v in cmp.years], years_higher=cmp.years_higher,
        years_compared=cmp.years_compared, median_value=round(cmp.median, 3), class_key=cmp.class_key,
        class_label=hydro_calc.CLASS_LABELS[cmp.class_key], text=text)


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


# ---------- rekomendacje ----------

def recommendation_facts(c: Computed, status: WaterStatus, history: HistorySection, soil_data: soilgrids.SoilData | None,
                         soil: SoilSection, satellite: SatelliteSection, satellite_field_check: bool,
                         hydrology: HydrologySection) -> rules.Facts:
    """Policzone wartości działki w postaci, na której działają reguły rekomendacji."""
    crop, last = c.crop, c.dates[-1]
    main = c.assessment  # pełna precyzja; reguły same formatują liczby w tekstach
    variant = c.variants[0]
    past = [s for s in history.seasons if s.complete]
    stressed_days = [s.stress_days_critical for s in past if s.stressed]

    harvest_day = next_sowing = bare_days = None
    uses_field_dates = next_sowing_provided = False
    if not crop.perennial:
        season = season_containing(crop, last) or last_completed_season(crop, last)
        harvest_day = season.harvest - timedelta(days=1)
        next_sowing = sowing_after(crop, season)
        bare_days = (next_sowing - harvest_day).days - 1
        uses_field_dates = season == crop.season_override
        next_sowing_provided = uses_field_dates and crop.next_sowing_date is not None
    bare = analysis.bare_period_stats(c.dates, crop, c.main, c.series.rain_mm)

    soc = None
    if soil_data is not None:
        top = [(layer.soc_g_kg, min(layer.bottom_cm, 30) - layer.top_cm) for layer in soil_data.layers
               if layer.top_cm < 30 and layer.soc_g_kg is not None]
        if top:
            soc = sum(v * w for v, w in top) / sum(w for _, w in top)

    return rules.Facts(
        crop_key=crop.key, crop_name=crop.name, perennial=crop.perennial, analysis_day=last,
        in_season=c.in_season, stage=c.crop_daily.stage[-1], class_key=main.class_key,
        depletion_mm=main.depletion_mm, raw_mm=main.raw_mm, taw_mm=main.taw_mm,
        variants=[(c.assessments[v.key].depletion_mm, c.assessments[v.key].raw_mm) for v in c.variants],
        spans_classes=status.spans_classes, soil_assumed=status.soil_assumed,
        awc_mm_per_m=(variant.fc_root - variant.wp_root) * 1000.0,
        topsoil_label=soil.layers[0].texture_label if soil.layers else None, soc_0_30_g_kg=soc,
        seasons_total=len(past), seasons_with_stress=len(stressed_days),
        seasons_with_long_stress=sum(1 for d in stressed_days if d >= LONG_STRESS_DAYS),
        median_stress_days=float(np.median(stressed_days)) if stressed_days else None,
        days_to_stress=main.days_to_stress, etc_mm_day=main.etc_mm_day,
        harvest_day=harvest_day, next_sowing_day=next_sowing, bare_period_days=bare_days,
        bare_rain_mm=bare["rain_mm"] if bare else None, bare_evaporation_mm=bare["evaporation_mm"] if bare else None,
        bare_from=bare["date_from"] if bare else None, bare_to=bare["date_to"] if bare else None,
        uses_field_dates=uses_field_dates, next_sowing_provided=next_sowing_provided,
        satellite_green_cover=satellite.green_cover, satellite_agreement=satellite.agreement,
        satellite_field_check=satellite_field_check,
        watercourse_distance_m=hydrology.nearest_watercourse_distance_m,
        watercourse_name=hydrology.nearest_watercourse_name,
        river_class=hydrology.class_key,
        river_evidence=(f"Na wodowskazie {hydrology.station_name} ({hydrology.river}, {fmt(hydrology.station_distance_km)} km "
                        f"od działki) wody było mniej niż w tych samych dniach w {hydrology.years_higher} z "
                        f"{hydrology.years_compared} poprzednich lat." if hydrology.status == Status.ok else None))


def recommendations_section(facts: rules.Facts) -> Recommendations:
    result = rules.build(facts)

    def convert(items: list[rules.Rec]) -> list[Recommendation]:
        return [Recommendation(key=r.key, category=r.category, title=r.title, what=r.what, where=r.where, why=r.why,
                               confidence=r.confidence, confidence_reason=r.confidence_reason, evidence=r.evidence,
                               timing=r.timing)
                for r in items]

    return Recommendations(
        status=Status.ok, retention=convert(result.retention), agrotechnical=convert(result.agrotechnical),
        irrigation=convert(result.irrigation), field_checks=convert(result.field_checks),
        irrigation_note=result.irrigation_note)


# ---------- raport ----------

def _no_weather_report(request: ReportRequest, parcel: parcels.Parcel | None, sources: list[SourceInfo],
                       started: float, timings: dict[str, float], soil: SoilSection,
                       hydrology: HydrologySection) -> ReportResponse:
    reason = ("Żaden dostawca pogody nie odpowiedział. Bez opadu i ewapotranspiracji nie da się policzyć "
              "bilansu wodnego, więc oceny niedoboru wody nie ma. Spróbuj ponownie za kilka minut.")
    dependent = "Wymaga bilansu wodnego, a ten nie powstał z powodu braku pogody."
    crop = request.crop_with_timeline()
    return ReportResponse(
        generated_at=datetime.now(timezone.utc), elapsed_s=round(time.perf_counter() - started, 2),
        request=request, analysis_date=request.date, parcel=_parcel_info(parcel) if parcel else None,
        crop=CropInfo(key=request.crop, name=crop.name, in_season=False),
        summary=[reason],
        water_status=WaterStatus(status=Status.error, reason=reason),
        satellite=SatelliteSection(status=Status.no_data, reason=NOT_CONNECTED),
        history=HistorySection(status=Status.no_data, reason=dependent),
        causes=CausesSection(status=Status.no_data, reason=dependent),
        soil=soil,
        terrain=TerrainRef(status=Status.no_data, reason=NOT_CONNECTED),
        hydrology=hydrology,
        recommendations=Recommendations(
            status=Status.no_data,
            reason="Rekomendacje powstają dopiero po ocenie sytuacji wodnej, a tej nie udało się policzyć."),
        limitations=[reason], sources=sources, timings_s=timings)


# źródło pobierane równolegle → etap pokazywany rolnikowi w trakcie liczenia
PROGRESS_STAGE = {"weather": "weather", "soil": "soil", "hydrology": "water"}


async def build_report(request: ReportRequest, today: date | None = None,
                       satellite_budget_s: float = SATELLITE_INLINE_BUDGET_S, progress=None) -> ReportResponse:
    """Pełny raport. `satellite_budget_s` to czas, jaki raport czeka na zdjęcia satelitarne.
    `progress(etap, stan)`: zgłasza rzeczywisty postęp ('running' | 'done' | 'skipped') dla widoku liczenia."""
    started = time.perf_counter()

    def mark(stage: str, state: str) -> None:
        if progress is not None:
            progress(stage, state)

    today = today or today_warsaw()
    if request.date > today:
        raise HTTPException(status_code=422, detail="Data analizy nie może być z przyszłości.")
    if request.date < MIN_ANALYSIS_DATE:
        raise HTTPException(status_code=422, detail="Data analizy jest zbyt odległa (najwcześniej 01.01.2005).")
    crop = request.crop_with_timeline()
    timings: dict[str, float] = {}

    # Ostatni dzień, który może wejść do obliczeń. Dla „dziś” jest to wczoraj (ostatnia pełna doba),
    # dla daty historycznej sama data. Nic późniejszego nie jest pobierane.
    end = request.date if request.date < today else today - timedelta(days=1)
    start = analysis.same_day_years_back(end, HISTORY_YEARS) - timedelta(days=WARMUP_DAYS)

    async with httpx.AsyncClient(headers={"User-Agent": USER_AGENT}, follow_redirects=True) as client:
        t0 = time.perf_counter()
        mark("parcel", "running")
        parcel, uldk_info = await resolve_parcel(client, request)
        mark("parcel", "done")
        mark("satellite", "running" if parcel is not None else "skipped")
        for stage in ("weather", "soil", "water"):
            mark(stage, "running")
        timings["uldk"] = round(time.perf_counter() - t0, 2)
        lon, lat = parcel.centroid_lonlat if parcel else (request.point.lon, request.point.lat)
        geometry = parcel.geometry if parcel else ShapelyPoint(lon, lat)

        # Zdjęcia satelitarne czytamy w wątku od razu po poznaniu działki, równolegle z resztą źródeł.
        satellite_started = time.perf_counter()
        satellite_task = None
        if parcel is not None:
            satellite_task = asyncio.create_task(asyncio.to_thread(
                sentinel.observe, parcel.id, parcel.geometry, request.date, today, satellite_budget_s))

        if parcel is not None:
            terrain_service.start(parcel)   # NMT liczy się w tle; frontend dociąga wynik osobnym zapytaniem

        async def timed(name: str, coro):
            started_at = time.perf_counter()
            result = await coro
            timings[name] = round(time.perf_counter() - started_at, 2)
            if name in PROGRESS_STAGE:
                mark(PROGRESS_STAGE[name], "done")
            return result

        t0 = time.perf_counter()
        async def no_forecast():
            return None, "Prognoza zapasu jest liczona tylko dla analizy na dziś."

        async def no_ifs():   # data historyczna: model wilgotności nie działa z zasady, bez ramki w raporcie
            return None, None

        weather_result, (soil_data, soil_info), (hydro_result, hydro_info), (watercourse, watercourse_info), \
            (moisture, moisture_info), (forecast, forecast_reason), (ifs, ifs_reason) = await asyncio.gather(
                timed("weather", weather.fetch_weather(client, lat, lon, start, end, today)),
                timed("soil", fetch_soil_safe(client, geometry)),
                timed("hydrology", fetch_hydrology_safe(client, lon, lat, request.date, today)),
                timed("watercourses", fetch_watercourse_safe(client, geometry)),
                timed("soil_moisture", fetch_moisture_safe(client, lat, lon, start, end)),
                timed("forecast", fetch_forecast_safe(client, lat, lon, today) if request.date >= today else no_forecast()),
                timed("ifs_forecast", fetch_ifs_safe(client, lat, lon, today) if request.date >= today else no_ifs()))
        timings["sources_parallel"] = round(time.perf_counter() - t0, 2)

    sources = [uldk_info, *weather_sources(weather_result), soil_info]
    soil = soil_section(soil_data, soil_info, crop)
    if weather_result.series is None or len(weather_result.series.dates) < 400:
        _satellite_result, satellite_info = await finish_satellite(satellite_task, satellite_started)
        sources.append(satellite_info)
        sources.append(hydro_info)
        sources.append(watercourse_info)
        sources.append(moisture_info)
        hydrology = hydrology_section(hydro_result, hydro_info, None, False)
        add_watercourse(hydrology, watercourse, watercourse_info, parcel is None)
        return _no_weather_report(request, parcel, sources, started, timings, soil, hydrology)

    t0 = time.perf_counter()
    mark("balance", "running")
    soil_assumed = soil_data is None
    variants = [assumed_variant()] if soil_assumed else build_variants(soil_data.layers, crop.root_depth_m)
    computed = compute(weather_result.series, crop, variants)
    status = water_status(computed, soil_assumed)
    status.forecast_reason = forecast_reason
    project_forecast(status, computed, forecast)
    status.ml_forecast = ml_forecast(computed, soil_data.layers if soil_data else None, ifs, ifs_reason, today)
    irrigation_need = irrigation_need_section(computed)
    history = history_section(computed)
    causes = causes_section(computed, status, soil_assumed)
    timings["compute"] = round(time.perf_counter() - t0, 3)
    mark("balance", "done")

    satellite_result, satellite_info = await finish_satellite(satellite_task, satellite_started)
    if parcel is not None:
        mark("satellite", "done")
    mark("recommendations", "running")
    timings["satellite"] = satellite_info.elapsed_s or 0.0
    satellite, satellite_field_check = satellite_section(
        satellite_result, satellite_info, computed, status.class_key or "none", request, parcel.id if parcel else None,
        location=(lat, lon))
    if satellite.status != Status.ok and satellite_info.status == Status.ok:
        satellite_info.status, satellite_info.reason = satellite.status, satellite.reason
        if satellite.status == Status.no_data:
            satellite_info.impact = SATELLITE_NO_IMPACT
    sources.append(satellite_info)

    limitations = list(MODEL_LIMITATIONS)
    if crop.season_override is None:
        limitations.append("Terminy siewu i zbioru oszacowano z kalendarza gatunku.")
    else:
        limitations.append("Terminy siewu i zbioru podane dla pola dotyczą jednego sezonu. Pozostałe terminy oszacowano.")
        if crop.next_sowing_date is not None:
            limitations.append("Data kolejnego siewu służy do oceny przerwy po zbiorze. Bilans kolejnej uprawy opiera się na kalendarzu gatunku.")
    last = computed.dates[-1]
    if last < end:
        limitations.insert(0, f"Dane pogodowe kończą się {fmt_date(last)}, czyli {plural_days((end - last).days)} "
                              "przed ostatnim dniem analizy. Późniejszy opad nie jest uwzględniony.")
    if request.date >= today:
        limitations.insert(0, f"Analiza „na dziś” kończy się na ostatniej pełnej dobie ({fmt_date(end)}).")
    if soil_assumed:
        limitations.insert(0, "Brak danych o glebie: bilans policzono dla gleby umownej, wynik jest orientacyjny.")

    hydrology = hydrology_section(hydro_result, hydro_info, status.class_key, computed.in_season)
    add_watercourse(hydrology, watercourse, watercourse_info, parcel is None)
    sources.append(hydro_info)
    soil_moisture = soil_moisture_section(moisture, moisture_info, end, status.class_key)
    sources.append(moisture_info)
    sources.append(watercourse_info)
    river_cause = hydrology_cause(hydrology)
    if river_cause:
        if not causes.items and status.class_key not in ("moderate", "severe"):
            causes.reason = None
        causes.items.append(river_cause)
    terrain_ref = (TerrainRef(status=Status.pending, endpoint="/api/terrain?" + urlencode({"parcel_id": parcel.id}),
                              reason="Spadek i drogi spływu liczą się osobno z modelu terenu (zwykle 15–60 s).")
                   if parcel is not None else
                   TerrainRef(status=Status.no_data, reason="Brak granicy działki (raport dla punktu), więc nie ma "
                                                            "dla czego policzyć spływu."))
    limitations.append(HYDROLOGY_IMPACT)
    recommendations = recommendations_section(recommendation_facts(
        computed, status, history, soil_data, soil, satellite, satellite_field_check, hydrology))

    summary = [status.headline or ""]
    if status.text:
        summary.append(status.text[-1] if not computed.in_season else status.text[0])
    if status.uncertainty_text:
        summary.append(status.uncertainty_text)
    first = next(iter([*recommendations.retention, *recommendations.agrotechnical]), None)
    if first:
        summary.append(f"Najważniejsze działanie: {first.title.lower()}.")

    return ReportResponse(
        generated_at=datetime.now(timezone.utc), elapsed_s=round(time.perf_counter() - started, 2),
        request=request, analysis_date=request.date, parcel=_parcel_info(parcel) if parcel else None,
        crop=crop_info(computed, request), summary=summary,
        water_status=status, satellite=satellite, history=history, causes=causes, soil=soil,
        soil_moisture=soil_moisture, irrigation_need=irrigation_need, terrain=terrain_ref, hydrology=hydrology, recommendations=recommendations,
        limitations=limitations, sources=sources, timings_s=timings)
