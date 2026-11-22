"""Bilans wodny działki policzony dla wszystkich wariantów gleby i stan uprawy w dniu analizy.

Same obliczenia na gotowych seriach. Zaokrąglenia i zdania do raportu są w app/presentation.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date

import numpy as np

from app.core.crops import GROWTH_TEMP_THRESHOLD_C, Crop, CropDaily, daily_crop_arrays
from app.core.soil import SoilVariant
from app.core.water_assessment import WaterAssessment, assess
from app.core.water_balance import (
    BalanceResult,
    run_water_balance,
    total_available_water_mm,
    total_evaporable_water_mm,
)
from app.sources.weather import DailyWeather

# Średnia temperatura z ostatnich 10 dni decyduje, czy uprawa rośnie; liczymy ją z co najmniej 5 dni z danymi.
TEMPERATURE_DAYS = 10
MIN_TEMPERATURE_DAYS = 5
# Założona dawka jednego nawadniania (założenie projektowe, do zmiany przy znanej instalacji).
IRRIGATION_DOSE_MM = 25.0


@dataclass
class Computed:
    dates: list[date]
    series: DailyWeather
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

    @property
    def main_variant(self) -> SoilVariant:
        return self.variants[0]


def compute(series: DailyWeather, crop: Crop, variants: list[SoilVariant]) -> Computed:
    dates = series.dates
    crop_daily = daily_crop_arrays(crop, dates)
    balances: dict[str, BalanceResult] = {}
    for variant in variants:
        taw = total_available_water_mm(variant.fc_root, variant.wp_root, crop.root_depth_m)
        tew = total_evaporable_water_mm(variant.fc_top, variant.wp_top)
        balances[variant.key] = run_water_balance(
            series.rain_mm, series.et0_mm, crop_daily.kc, crop_daily.in_field,
            taw_mm=taw, p_table=crop.p, tew_mm=tew, rew_mm=variant.rew_mm)
    tmean = (series.tmin_c[-TEMPERATURE_DAYS:] + series.tmax_c[-TEMPERATURE_DAYS:]) / 2.0
    tmean_10d = float(np.nanmean(tmean)) if np.isfinite(tmean).sum() >= MIN_TEMPERATURE_DAYS else None
    in_field = bool(crop_daily.in_field[-1]) and crop_daily.stage[-1] != "dormant"
    in_season = in_field and (tmean_10d is None or tmean_10d >= GROWTH_TEMP_THRESHOLD_C)
    return Computed(dates, series, crop, crop_daily, variants, balances, variants[0].key,
                    in_field, in_season, tmean_10d, {key: assess(b) for key, b in balances.items()})


def irrigated_balance(c: Computed) -> BalanceResult:
    """Ten sam bilans, ale z dawką IRRIGATION_DOSE_MM za każdym razem, gdy zapas spada poniżej progu stresu."""
    variant = c.main_variant
    return run_water_balance(
        c.series.rain_mm, c.series.et0_mm, c.crop_daily.kc, c.crop_daily.in_field, taw_mm=c.main.taw_mm, p_table=c.crop.p,
        tew_mm=total_evaporable_water_mm(variant.fc_top, variant.wp_top), rew_mm=variant.rew_mm, refill_at_raw=True,
        dose_mm=IRRIGATION_DOSE_MM)


def project_balance(c: Computed, dates: list[date], rain_mm: np.ndarray,
                    et0_mm: np.ndarray) -> tuple[CropDaily, BalanceResult]:
    """Bilans puszczony dalej po dniach prognozy: ten sam model i parametry, start od zapasu z ostatniej doby."""
    variant = c.main_variant
    crop_daily = daily_crop_arrays(c.crop, dates)
    result = run_water_balance(
        rain_mm, et0_mm, crop_daily.kc, crop_daily.in_field,
        taw_mm=c.main.taw_mm, p_table=c.crop.p, tew_mm=total_evaporable_water_mm(variant.fc_top, variant.wp_top),
        rew_mm=variant.rew_mm, initial_depletion_mm=float(c.main.depletion_mm[-1]))
    return crop_daily, result
