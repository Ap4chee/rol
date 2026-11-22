"""Sekcja satelitarna: obserwacje Sentinel-2, zgodność wskaźników z bilansem i prognoza NDMI z modelu ML."""
from __future__ import annotations

from dataclasses import asdict
from datetime import date, timedelta
from urllib.parse import urlencode

from app.core import satellite_logic
from app.core.balance_run import Computed
from app.core.textfmt import fmt_date, signed
from app.presentation.sections.sources_info import SATELLITE_NO_IMPACT
from app.schemas import NdmiForecast, ReportRequest, SatelliteObservation, SatelliteSection, SourceInfo, Status
from app.services.ml_bridge import NdmiPrediction
from app.sources import sentinel

CLEAR_SCENE_SHARE = 0.65   # zdjęcie uznajemy za czyste, gdy tyle pikseli działki to roślinność albo odkryta gleba
CLOUDY_REASON = "chmury"
BARE_REASON = "brak zielonej roślinności"


def satellite_endpoint(request: ReportRequest, parcel_id: str) -> str:
    query = request.model_dump(mode="json", exclude_none=True, exclude={"point"})
    return "/api/satellite?" + urlencode({**query, "parcel_id": parcel_id})


def _observation(o: sentinel.Observation) -> SatelliteObservation:
    return SatelliteObservation(
        scene_id=o.scene_id, date=date.fromisoformat(o.date), valid_pixels=o.valid_pixels, total_pixels=o.total_pixels,
        coverage_pct=round(100 * o.coverage, 0), bare_pixels=o.bare_pixels, cloudy_pixels=o.cloudy_pixels,
        accepted=o.accepted and o.ndmi is not None, reject_reason=o.reject_reason,
        ndvi=round(o.ndvi, 3) if o.ndvi is not None else None, ndmi=round(o.ndmi, 3) if o.ndmi is not None else None)


def ndmi_forecast(prediction: NdmiPrediction | None, c: Computed, analysis_date: date) -> NdmiForecast | None:
    """Prognoza modelu ze zdaniami do raportu. Model nie podaje dawki wody, tylko kierunek zmiany wskaźnika."""
    if prediction is None:
        return None
    fc = NdmiForecast(**asdict(prediction))
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


def _no_usable_scene(section: SatelliteSection, result: sentinel.SatelliteResult,
                     observations: list[SatelliteObservation], pending: bool) -> None:
    """Powód braku wskaźników: działka za mała, brak zdjęć albo same chmury i gołe pole."""
    section.agreement = "inconclusive"
    if observations and all(o.total_pixels < sentinel.MIN_PIXELS for o in observations):
        section.status = Status.no_data
        section.reason = (f"Działka jest za mała albo za wąska dla Sentinel-2: mieści {observations[0].total_pixels} "
                          f"środków pikseli 20 m, a potrzeba co najmniej {sentinel.MIN_PIXELS}.")
    elif not observations:
        section.status = Status.no_data
        section.reason = (f"W oknie {fmt_date(result.window_from)}–{fmt_date(result.window_to)} nie ma zdjęć Sentinel-2 "
                          "dla tej działki (archiwum L2A zaczyna się w 2017 r.).")
    elif not pending:
        cloudy = sum(1 for o in observations if o.reject_reason and CLOUDY_REASON in o.reject_reason)
        bare = sum(1 for o in observations if o.reject_reason and BARE_REASON in o.reject_reason)
        section.status = Status.no_data
        section.reason = (f"W oknie 45 dni przed datą było {len(observations)} zdjęć, ale żadne nie pokazuje czystej "
                          f"roślinności na działce: {cloudy} z chmurami, {bare} bez zielonej roślinności, "
                          f"{len(observations) - cloudy - bare} z innych powodów.")
        if bare and section.green_cover is False:
            newest_bare = max(o.date for o in observations if o.reject_reason and BARE_REASON in o.reject_reason)
            section.text.append(
                f"Najnowsze czyste zdjęcie ({fmt_date(newest_bare)}) pokazuje pole bez zielonej roślinności: odkrytą glebę, "
                "resztki albo zaschnięte, dojrzałe rośliny. Wskaźniki roślinne nie mają wtedy zastosowania.")
    if section.status != Status.ok:
        section.text.append(SATELLITE_NO_IMPACT)


def satellite_section(result: sentinel.SatelliteResult | None, info: SourceInfo, c: Computed, class_key: str,
                      request: ReportRequest, parcel_id: str | None,
                      prediction: NdmiPrediction | None) -> tuple[SatelliteSection, bool]:
    """Sekcja satelitarna i informacja, czy rozbieżność z bilansem uzasadnia oględziny pola."""
    if result is None:
        return SatelliteSection(status=info.status, reason=info.reason, text=[SATELLITE_NO_IMPACT]), False
    observations = [_observation(o) for o in result.observations]
    section = SatelliteSection(status=Status.ok, window_from=result.window_from, window_to=result.window_to,
                               scenes_found=result.scenes_found, observations=observations)
    used = [o for o in observations if o.accepted]
    pending = result.unfinished > 0

    # co pokazuje najnowsze czyste zdjęcie: zieloną okrywę czy odkrytą glebę
    clear = [o for o in observations
             if o.total_pixels and (o.valid_pixels + o.bare_pixels) >= CLEAR_SCENE_SHARE * o.total_pixels]
    if clear:
        section.green_cover = clear[-1].valid_pixels >= clear[-1].bare_pixels

    field_check = False
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
        _no_usable_scene(section, result, observations, pending)

    if pending and parcel_id:
        section.status = Status.pending
        section.endpoint = satellite_endpoint(request, parcel_id)
        section.reason = (f"Część zdjęć jeszcze się wczytuje ({result.unfinished} scen; łącze do archiwum zdjęć jest wolne). "
                          "Wynik uzupełni się sam, zwykle w ciągu minuty.")
    section.ndmi_forecast = ndmi_forecast(prediction, c, request.date)
    if not c.in_season and section.green_cover is True and c.crop_daily.stage[-1] == "off_season":
        section.text.append("Na polu widać zieloną okrywę, choć według kalendarza wybranej uprawy pole powinno być puste. "
                            "To może być międzyplon, samosiewy albo inna uprawa niż wybrana. Okrywa ogranicza spływ "
                            "i parowanie, więc warto ją utrzymać do wiosny.")
    return section, field_check


def sync_satellite_source(info: SourceInfo, section: SatelliteSection) -> None:
    """Zdjęcia przyszły, ale nic z nich nie wynika: tabela źródeł ma pokazać to samo co sekcja."""
    if section.status != Status.ok and info.status == Status.ok:
        info.status, info.reason = section.status, section.reason
        if section.status == Status.no_data:
            info.impact = SATELLITE_NO_IMPACT
