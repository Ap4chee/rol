"""Historia: ten sam bilans policzony dla 10 poprzednich sezonów i porównanie z tym samym dniem w latach wstecz."""
from __future__ import annotations

from dataclasses import asdict

import numpy as np

from app.config import HISTORY_YEARS
from app.core import analysis
from app.core.balance_run import Computed
from app.core.textfmt import fmt, fmt_date, plural_days
from app.schemas import HistorySection, SeasonStress, Status

LONG_STRESS_DAYS = 14       # „długi” stres w okresie krytycznym (do opisu historii)
SEVERE_SEASON_DAYS = 7      # tyle dni silnego niedoboru w okresie krytycznym wyróżnia sezon w opisie historii
MIN_PAST_SEASONS = 3


def _season_row(row: analysis.SeasonStress) -> SeasonStress:
    return SeasonStress(**{**asdict(row), "max_depletion_pct_taw": round(row.max_depletion_pct_taw, 0)})


def _stress_text(past: list[analysis.SeasonStress], with_stress: list[analysis.SeasonStress]) -> list[str]:
    days = sorted(r.stress_days_critical for r in with_stress)
    worst = max(with_stress, key=lambda r: r.stress_days_critical)
    long_ones = sum(1 for d in days if d >= LONG_STRESS_DAYS)
    severe = [r for r in past if r.severe_days_critical >= SEVERE_SEASON_DAYS]
    return [
        f"W sezonach ze stresem trwał on od {days[0]} do {plural_days(days[-1])} (mediana {fmt(float(np.median(days)))}), "
        f"a co najmniej {LONG_STRESS_DAYS} dni w {long_ones} z {len(past)} sezonów. "
        f"Najdłużej w sezonie {worst.season}: {plural_days(worst.stress_days_critical)}, "
        f"w tym {plural_days(worst.longest_stress_run_days)} z rzędu.",
        f"Silny niedobór (wyczerpana ponad połowa wody trudno dostępnej) trwał co najmniej {SEVERE_SEASON_DAYS} dni "
        f"w {len(severe)} z {len(past)} sezonów" + (f": {', '.join(r.season for r in severe)}." if severe else "."),
    ]


def history_section(c: Computed) -> HistorySection:
    rows = analysis.seasons_history(c.dates, c.crop, c.crop_daily, c.main, HISTORY_YEARS)
    past = [r for r in rows if r.complete][-HISTORY_YEARS:]
    current = next((r for r in rows if not r.complete), None)
    if len(past) < MIN_PAST_SEASONS:
        return HistorySection(status=Status.no_data,
                              reason="Seria pogodowa obejmuje mniej niż 3 pełne sezony przed datą analizy.")
    seasons = [_season_row(r) for r in past]
    if current:
        seasons.append(_season_row(current))
    with_stress = [r for r in past if r.stressed]
    text = [
        f"Ten sam bilans policzono dla {len(past)} sezonów do daty analizy, tak jakby co roku uprawiano tu to samo "
        f"({c.crop.name.lower()}). W okresie krytycznym dla plonu stres wodny wystąpił w {len(with_stress)} z {len(past)} sezonów."
    ]
    if with_stress:
        text += _stress_text(past, with_stress)
    if current:
        text.append(
            f"Bieżący sezon {current.season} (okres krytyczny trwa do {fmt_date(current.critical_to)}): "
            f"dotąd {plural_days(current.stress_days_critical)} stresu.")
    pct = 100.0 * c.main.depletion_mm / c.main.taw_mm if c.main.taw_mm > 0 else np.zeros(len(c.dates))
    same = analysis.same_day_comparison(c.dates, pct, HISTORY_YEARS)
    section = HistorySection(status=Status.ok, seasons=seasons, seasons_with_stress=len(with_stress),
                             seasons_with_long_stress=sum(1 for r in past if r.stress_days_critical >= LONG_STRESS_DAYS),
                             long_stress_days=LONG_STRESS_DAYS, seasons_total=len(past), text=text)
    # porównanie z tym samym dniem w poprzednich latach idzie w polach same_day_* (frontend pokazuje je osobno)
    if same:
        section.same_day_current_pct = round(same.current_pct, 0)
        section.same_day_median_pct = round(same.median_pct, 0)
        section.same_day_drier_years = same.drier_years
        section.same_day_years = same.years
    return section
