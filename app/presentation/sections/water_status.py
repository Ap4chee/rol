"""Sekcja 1 raportu: sytuacja wodna w dniu analizy, niepewność z wariantów gleby, klimatyczny bilans wodny,
miniony sezon i przebieg dzienny do wykresu. Tu i tylko tu liczby z bilansu są zaokrąglane."""
from __future__ import annotations

from app.config import HISTORY_YEARS
from app.core import analysis
from app.core.balance_run import Computed
from app.core.crops import last_completed_season
from app.core.soil import SoilVariant
from app.core.water_assessment import WaterAssessment
from app.core.water_balance import CLASS_KEYS, CLASS_LABELS_IN_SEASON, CLASS_LABELS_OFF_SEASON
from app.presentation.sections.crop import season_reason
from app.presentation.textfmt import fmt, fmt_date, plural_days
from app.schemas import BalanceVariant, ClimaticWaterBalance, DailyPoint, SeasonSummary, Status, WaterStatus

SERIES_DAYS_FOR_CHART = 365   # rok wstecz: wykres pokazuje ok. 4 miesiące, resztę odsłania przeciąganie
CWB_DAYS = 60                 # klimatyczny bilans wodny z 60 dni, jak w monitoringu suszy rolniczej


def variant_result(variant: SoilVariant, a: WaterAssessment, in_season: bool) -> BalanceVariant:
    labels = CLASS_LABELS_IN_SEASON if in_season else CLASS_LABELS_OFF_SEASON
    return BalanceVariant(
        key=variant.key, label=variant.label,
        field_capacity_vol_pct=round(variant.fc_root * 100, 1), wilting_point_vol_pct=round(variant.wp_root * 100, 1),
        taw_mm=round(a.taw_mm, 0), raw_mm=round(a.raw_mm, 0), depletion_mm=round(a.depletion_mm, 0),
        depletion_pct_taw=round(a.depletion_pct_taw, 0), available_mm=round(a.available_mm, 0), ks=round(a.ks, 2),
        class_key=a.class_key, class_label=labels[a.class_key])


def _in_season_text(c: Computed) -> list[str]:
    a = c.assessment   # porównania na pełnej precyzji
    text = [
        f"Stan na {fmt_date(c.dates[-1])}: w strefie korzeni (do {fmt(c.crop.root_depth_m, 1)} m) brakuje "
        f"{fmt(a.depletion_mm)} mm wody do pełnego zapasu. Roślinom zostaje {fmt(a.available_mm)} mm "
        f"wody dostępnej z {fmt(a.taw_mm)} mm, które ta gleba może utrzymać (TAW)."]
    if a.stressed:
        text.append(
            f"Wyczerpanie przekroczyło próg wody łatwo dostępnej (RAW = {fmt(a.raw_mm)} mm) o "
            f"{fmt(-a.margin_to_stress_mm)} mm. Rośliny pobierają wodę z trudem: zużycie spada do "
            f"ok. {fmt(a.ks * 100)}% potrzeb (współczynnik stresu Ks = {fmt(a.ks, 2)}).")
    else:
        sentence = f"Do progu stresu (RAW = {fmt(a.raw_mm)} mm) zostaje {fmt(a.margin_to_stress_mm)} mm."
        if a.days_to_stress is not None:
            sentence += (f" Przy zużyciu z ostatnich 7 dni ({fmt(a.etc_mm_day, 1)} mm na dobę) i bez opadu "
                         f"wystarczy to na ok. {plural_days(a.days_to_stress)}.")
        text.append(sentence)
    return text


def _off_season_text(c: Computed) -> list[str]:
    a = c.assessment
    return [
        season_reason(c),
        f"Stan zapasu wody w glebie na {fmt_date(c.dates[-1])}: w warstwie do {fmt(c.crop.root_depth_m, 1)} m jest "
        f"{fmt(a.available_mm)} mm wody dostępnej dla roślin z {fmt(a.taw_mm)} mm możliwych "
        f"(brakuje {fmt(a.depletion_mm)} mm, czyli {fmt(a.depletion_pct_taw)}%)."]


def _uncertainty(results: list[BalanceVariant], soil_assumed: bool) -> tuple[str, bool]:
    """Opis rozrzutu wyniku między wariantami gleby i czy warianty dają różne klasy."""
    if soil_assumed:
        return ("Brak danych o glebie: przyjęto glebę umowną (glina), więc wynik jest orientacyjny, "
                "a przedziału niepewności gleby nie policzono."), False
    if len(results) <= 1:
        return "SoilGrids nie podał kwantyli dla tej działki, więc przedziału niepewności gleby nie policzono.", False
    ordered = sorted(results, key=lambda r: CLASS_KEYS.index(r.class_key))
    low, high = ordered[0], ordered[-1]
    pcts = [r.depletion_pct_taw for r in results]
    spans = low.class_key != high.class_key
    text = (
        f"Mapa gleb (SoilGrids, 250 m) nie zna dokładnie gleby na tym polu, więc bilans policzono też dla gleby "
        f"lżejszej i cięższej (przedział 5–95%). Strefa korzeni mieści wtedy od {fmt(min(r.taw_mm for r in results))} "
        f"do {fmt(max(r.taw_mm for r in results))} mm wody, a ubytek wynosi od {fmt(min(pcts))}% do {fmt(max(pcts))}% zapasu.")
    if spans:
        text += (f" Wynik zależy od gleby: od „{low.class_label}” do „{high.class_label}”. "
                 "Rozstrzygnie to sprawdzenie gleby na polu.")
    else:
        text += f" We wszystkich wariantach wynik jest ten sam: „{results[0].class_label}”."
    return text, spans


def _climatic_balance(c: Computed) -> ClimaticWaterBalance | None:
    cwb = analysis.climatic_water_balance(c.dates, c.series.rain_mm, c.series.et0_mm, CWB_DAYS, HISTORY_YEARS)
    if cwb is None:
        return None
    text = (f"Klimatyczny bilans wodny (opad − ET0) z 60 dni do {fmt_date(cwb.date_to)}: "
            f"{fmt(cwb.rain_mm)} − {fmt(cwb.et0_mm)} = {fmt(cwb.balance_mm)} mm.")
    if cwb.median_10y_mm is not None:
        text += (f" Mediana z {cwb.years_compared} poprzednich lat dla tego samego okresu: "
                 f"{fmt(cwb.median_10y_mm)} mm; suchszy był on w {cwb.drier_years} z nich.")
    return ClimaticWaterBalance(
        days=CWB_DAYS, date_from=cwb.date_from, date_to=cwb.date_to, rain_mm=round(cwb.rain_mm, 0),
        et0_mm=round(cwb.et0_mm, 0), balance_mm=round(cwb.balance_mm, 0),
        median_10y_mm=round(cwb.median_10y_mm, 0) if cwb.median_10y_mm is not None else None,
        years_compared=cwb.years_compared, drier_years=cwb.drier_years, text=text)


def _last_season(c: Computed) -> SeasonSummary | None:
    previous = last_completed_season(c.crop, c.dates[-1])
    s = analysis.season_summary(c.dates, previous, c.crop_daily, c.main, c.series.rain_mm)
    if s is None:
        return None
    if s.stress_days_critical > 0:
        stress_text = (f"w okresie krytycznym dla plonu stres wodny trwał {plural_days(s.stress_days_critical)}, "
                       f"a w całym sezonie {plural_days(s.stress_days)} "
                       f"(najdłuższy ciąg {plural_days(s.longest_stress_run_days)})")
    elif s.stress_days > 0:
        stress_text = (f"stres wodny wystąpił przez {plural_days(s.stress_days)}, "
                       "ale poza okresem krytycznym dla plonu")
    else:
        stress_text = "bilans nie pokazał stresu wodnego"
    return SeasonSummary(
        season=s.season, date_from=s.date_from, date_to=s.date_to,
        rain_mm=round(s.rain_mm, 0), etc_mm=round(s.etc_mm, 0),
        stress_days=s.stress_days, stress_days_critical=s.stress_days_critical,
        longest_stress_run_days=s.longest_stress_run_days,
        max_depletion_pct_taw=round(s.max_depletion_pct_taw, 0),
        text=(f"Miniony sezon ({fmt_date(s.date_from)}–{fmt_date(s.date_to)}): opad "
              f"{fmt(s.rain_mm)} mm, zużycie wody przez uprawę {fmt(s.etc_mm)} mm; {stress_text}. "
              f"Największe wyczerpanie zapasu: {fmt(s.max_depletion_pct_taw)}%."))


def _daily_series(c: Computed) -> list[DailyPoint]:
    balance = c.main
    n = min(SERIES_DAYS_FOR_CHART, len(c.dates))
    start = len(c.dates) - n
    available_pct = 100.0 * (1.0 - balance.depletion_mm / balance.taw_mm)
    band = analysis.typical_band(c.dates, available_pct, start, HISTORY_YEARS)
    return [
        DailyPoint(date=c.dates[i], rain_mm=round(float(c.series.rain_mm[i]), 1), et0_mm=round(float(c.series.et0_mm[i]), 2),
                   etc_mm=round(float(balance.eta_mm[i]), 2), depletion_mm=round(float(balance.depletion_mm[i]), 1),
                   raw_mm=round(float(balance.raw_mm[i]), 1), taw_mm=round(float(balance.taw_mm), 1),
                   available_pct=round(float(available_pct[i]), 1),
                   stress_threshold_pct=round(100.0 * (1.0 - float(balance.raw_mm[i]) / balance.taw_mm), 1),
                   typical_p10_pct=round(band[i - start][0], 1) if band[i - start] else None,
                   typical_median_pct=round(band[i - start][1], 1) if band[i - start] else None,
                   typical_p90_pct=round(band[i - start][2], 1) if band[i - start] else None)
        for i in range(start, len(c.dates))]


def water_status(c: Computed, soil_assumed: bool) -> WaterStatus:
    results = [variant_result(v, c.assessments[v.key], c.in_season) for v in c.variants]
    main = results[0]
    if c.in_season:
        headline, text = main.class_label, _in_season_text(c)
    else:
        headline, text = "Uprawa nie jest w okresie wzrostu. " + main.class_label + ".", _off_season_text(c)
    uncertainty, spans = _uncertainty(results, soil_assumed)
    return WaterStatus(
        status=Status.ok, headline=headline, class_key=main.class_key, class_label=main.class_label,
        in_season=c.in_season, last_data_day=c.dates[-1], soil_assumed=soil_assumed, result=main, variants=results,
        spans_classes=spans, uncertainty_text=uncertainty, climatic_water_balance=_climatic_balance(c),
        last_season=_last_season(c), series=_daily_series(c), text=text)
