"""Ocena sytuacji wodnej w dniu analizy z wyniku bilansu FAO-56: jedna wersja liczb dla klasyfikacji, przyczyn i reguł.

Wartości są w pełnej precyzji. Zaokrąglanie należy wyłącznie do prezentacji (raport), żeby porównania z RAW
i liczba dni do progu stresu nie zależały od tego, jak liczba zostanie wyświetlona.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from app.core.water_balance import BalanceResult, classify, stress_coefficient

DEMAND_WINDOW_DAYS = 7          # zużycie wody (ETc) uśredniane z tylu ostatnich dni
MIN_DEMAND_FOR_DAYS_MM = 0.3    # poniżej tego zużycia [mm/d] nie podajemy liczby dni do progu stresu


@dataclass(frozen=True)
class WaterAssessment:
    """Stan strefy korzeni w ostatnim dniu bilansu (mm wody, bez zaokrągleń)."""
    depletion_mm: float     # Dr: ubytek wody do pojemności polowej
    raw_mm: float           # woda łatwo dostępna (próg stresu)
    taw_mm: float           # woda dostępna ogółem
    etc_mm_day: float       # średnie zużycie wody przez uprawę z ostatnich DEMAND_WINDOW_DAYS dni
    class_key: str          # none | watch | moderate | severe (water_balance.classify)

    @property
    def stressed(self) -> bool:
        """Ubytek przekroczył próg wody łatwo dostępnej."""
        return self.depletion_mm > self.raw_mm

    @property
    def margin_to_stress_mm(self) -> float:
        """Ile mm zostało do progu stresu (ujemne: o ile go przekroczono)."""
        return self.raw_mm - self.depletion_mm

    @property
    def available_mm(self) -> float:
        return max(self.taw_mm - self.depletion_mm, 0.0)

    @property
    def depletion_pct_taw(self) -> float:
        return 100.0 * self.depletion_mm / self.taw_mm if self.taw_mm > 0 else 100.0

    @property
    def p(self) -> float:
        return self.raw_mm / self.taw_mm if self.taw_mm > 0 else 0.5

    @property
    def ks(self) -> float:
        return stress_coefficient(self.depletion_mm, self.taw_mm, self.p)

    @property
    def days_to_stress(self) -> int | None:
        """Dni bez opadu do progu stresu przy obecnym zużyciu. None, gdy już stres albo zużycie znikome."""
        if self.stressed or self.etc_mm_day <= MIN_DEMAND_FOR_DAYS_MM:
            return None
        return max(int(self.margin_to_stress_mm / self.etc_mm_day), 0)


def assess(balance: BalanceResult) -> WaterAssessment:
    dr = float(balance.depletion_mm[-1])
    raw = float(balance.raw_mm[-1])
    taw = float(balance.taw_mm)
    etc = float(np.mean(balance.etc_mm[-DEMAND_WINDOW_DAYS:]))
    return WaterAssessment(depletion_mm=dr, raw_mm=raw, taw_mm=taw, etc_mm_day=etc,
                           class_key=classify(dr, raw, taw))
