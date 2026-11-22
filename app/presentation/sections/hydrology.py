"""Hydrologia: stan rzeki na najbliższym wodowskazie IMGW i najbliższy ciek z mapy MPHP10k."""
from __future__ import annotations

from app.core import hydrology as hydro_calc
from app.presentation.sections.sources_info import HYDRO_NO_IMPACT, river_name
from app.presentation.textfmt import fmt, fmt_date
from app.schemas import HydrologySection, HydroYear, Point, SourceInfo, Status
from app.sources import imgw_hydro, mphp

HYDROLOGY_CHECK = ("Sprawdź na mapie i w terenie, czy przy działce jest ciek, rów albo oczko wodne. Jeśli tak, zostaw "
                   "wzdłuż brzegu pas trwałej roślinności.")
WATERCOURSE_ROUNDING = -1   # mapa 1:10 000, linie uproszczone do ok. 8 m, więc odległość zaokrąglamy do 10 m


def hydrology_section(result: imgw_hydro.HydroResult | None, info: SourceInfo, class_key: str | None,
                      in_season: bool) -> HydrologySection:
    if result is None:
        return HydrologySection(status=info.status, reason=info.reason, text=[HYDRO_NO_IMPACT])
    s, cmp = result.station, result.comparison
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
        status=Status.ok, station_id=s.id, station_name=s.name, river=river_name(s.river),
        station_distance_km=round(s.distance_km, 1),
        station_location=Point(lon=s.lon, lat=s.lat), metric=result.metric, unit=result.unit, origin=result.origin,
        current_value=round(cmp.current, 3), current_from=result.current_from, current_to=result.current_to,
        years=[HydroYear(year=y, value=round(v, 3)) for y, v in cmp.years], years_higher=cmp.years_higher,
        years_compared=cmp.years_compared, median_value=round(cmp.median, 3), class_key=cmp.class_key,
        class_label=hydro_calc.CLASS_LABELS[cmp.class_key], text=text)


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
    distance_m = round(watercourse.distance_m, WATERCOURSE_ROUNDING)
    hydro.nearest_watercourse_name = watercourse.name
    hydro.nearest_watercourse_distance_m = distance_m
    name = watercourse.name or "bez nazwy"
    where = ("przecina działkę albo biegnie jej granicą" if distance_m == 0 and not is_point
             else f"jest ok. {fmt(distance_m)} m {edge}")
    hydro.text.insert(0, f"Najbliższy ciek na mapie MPHP10k ({name}) {where}.")
