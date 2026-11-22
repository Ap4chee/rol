"""Zapotrzebowanie na nawadnianie: ile wody netto trzeba by dodać w tym sezonie, w typowym i w suchym roku."""
from __future__ import annotations

from app.core.analysis import IrrigationNeed as NeedStats
from app.core.balance_run import IRRIGATION_DOSE_MM
from app.core.textfmt import count_noun, fmt, fmt_date
from app.schemas import IrrigationNeed, MonthAmount, Status


def _rounded(value: float | None) -> int | None:
    return round(value) if value is not None else None


def irrigation_need_section(need: NeedStats | None) -> IrrigationNeed:
    if need is None or (need.current_label is None and need.typical_mm is None):
        return IrrigationNeed(status=Status.no_data, reason="Za mało pełnych sezonów w danych, żeby policzyć zapotrzebowanie.")
    text = []
    if need.current_label is not None:
        text.append(f"W tym sezonie (od {fmt_date(need.season_from)}) utrzymanie zapasu powyżej progu stresu wymagałoby "
                    f"{fmt(need.so_far_mm)} mm wody ({count_noun(need.so_far_events, 'dawka', 'dawki', 'dawek')} "
                    f"po {fmt(IRRIGATION_DOSE_MM)} mm). Uprawa zużyła w tym czasie ok. "
                    f"{fmt(need.etc_so_far_mm)} mm, a spadło {fmt(need.rain_so_far_mm)} mm deszczu.")
    if need.typical_mm is not None:
        text.append(f"W typowym sezonie z ostatnich {need.seasons} lat potrzeba {fmt(need.typical_mm)} mm, w suchym "
                    f"(co dziesiąty rok) {fmt(need.dry_mm)} mm. "
                    + (f"Bez potrzeby nawadniania: {count_noun(need.seasons_without, 'sezon', 'sezony', 'sezonów')}."
                       if need.seasons_without else ""))
    text.append(f"To ilość netto, która ma trafić do gleby: dawka {fmt(IRRIGATION_DOSE_MM)} mm, gdy zapas spada poniżej progu "
                "stresu. Do wydajności instalacji trzeba doliczyć jej straty; wynik dotyczy przyjętego kalendarza uprawy i gleby "
                "z SoilGrids.")
    return IrrigationNeed(
        status=Status.ok, season_label=need.current_label, season_from=need.season_from,
        so_far_mm=_rounded(need.so_far_mm), so_far_events=need.so_far_events,
        etc_so_far_mm=_rounded(need.etc_so_far_mm), rain_so_far_mm=_rounded(need.rain_so_far_mm),
        typical_mm=_rounded(need.typical_mm), dry_mm=_rounded(need.dry_mm), seasons_compared=need.seasons,
        seasons_without=need.seasons_without, dose_mm=round(need.dose_mm) if need.dose_mm else None,
        monthly=[MonthAmount(month=m, mm=round(v, 1)) for m, v in need.monthly], text=text)
