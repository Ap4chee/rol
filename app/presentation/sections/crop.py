"""Uprawa w dniu analizy: faza, Kc, korzenie, przyjęte terminy i parametry z tablic FAO-56."""
from __future__ import annotations

from datetime import timedelta

import numpy as np

from app.core.balance_run import Computed
from app.core.crops import (
    GROWTH_TEMP_THRESHOLD_C,
    STAGE_NAMES_PL,
    Crop,
    Season,
    last_completed_season,
    root_depth_on,
    season_containing,
    season_for_harvest_year,
    sowing_after,
)
from app.presentation.textfmt import fmt, fmt_date
from app.schemas import CropInfo, CropParameter, ReportRequest


def _shown_season(crop: Crop, c: Computed) -> Season:
    last = c.dates[-1]
    season = season_containing(crop, last)
    if season is None:
        season = last_completed_season(crop, last)
        if crop.perennial:
            season = season_for_harvest_year(crop, last.year)
    return season


def _assumptions(crop: Crop, season: Season, request: ReportRequest) -> list[str]:
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
    if crop.perennial:
        assumptions.append("Użytek zielony jest uprawą trwałą: sezon liczony od 1 IV do 31 X.")
    assumptions.append(f"Głębokość korzeni pokazana w modelu rośnie liniowo od 0,15 m przy siewie do {fmt(crop.root_depth_m, 1)} m "
                       "na początku środka sezonu (FAO-56 rozdz. 8). Bilans wodny liczy stałą strefę korzeni "
                       f"{fmt(crop.root_depth_m, 1)} m przez cały sezon.")
    return assumptions


def _parameters(crop: Crop, season: Season) -> list[CropParameter]:
    phase_bounds = (season.sowing, season.development_start, season.mid_start, season.late_start, season.harvest)
    return [
        CropParameter(name="Współczynniki uprawy Kc (początek / środek / koniec sezonu)",
                      value=f"{fmt(crop.kc_ini, 2)} / {fmt(crop.kc_mid, 2)} / {fmt(crop.kc_end, 2)}",
                      source=crop.sources["kc"]),
        CropParameter(name="Głębokość korzeni Zr i frakcja p", value=f"{fmt(crop.root_depth_m, 1)} m; p = {fmt(crop.p, 2)}",
                      source=crop.sources["root"]),
        CropParameter(name="Długości faz [dni]",
                      value=" / ".join(str((end - start).days) for start, end in zip(phase_bounds, phase_bounds[1:])),
                      source=("Kalendarz gatunku dostosowany do terminów pola"
                              if season == crop.season_override else crop.sources["stages"])),
    ]


def crop_info(c: Computed, request: ReportRequest) -> CropInfo:
    crop, last = c.crop, c.dates[-1]
    season = _shown_season(crop, c)
    stage = c.crop_daily.stage[-1]
    kc = float(c.crop_daily.kc[-1]) if np.isfinite(c.crop_daily.kc[-1]) else None
    root_now = root_depth_on(crop, last)
    return CropInfo(
        key=crop.key, name=crop.name, in_season=c.in_season, stage_key=stage, stage_name=STAGE_NAMES_PL[stage],
        kc=round(kc, 2) if kc is not None else None, root_depth_m=crop.root_depth_m,
        root_depth_now_m=round(root_now, 2) if root_now is not None else None,
        depletion_fraction_p=crop.p,
        season_from=season.sowing, season_to=season.harvest - timedelta(days=1),
        critical_from=season.critical_start, critical_to=season.critical_end - timedelta(days=1),
        parameters=_parameters(crop, season), assumptions=_assumptions(crop, season, request))


def season_reason(c: Computed) -> str:
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
