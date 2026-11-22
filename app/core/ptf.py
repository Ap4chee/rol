"""Funkcja pedotransferowa: pojemność polowa i punkt więdnięcia z uziarnienia i materii organicznej.

Źródło: Saxton K.E., Rawls W.J. (2006), Soil Water Characteristic Estimates by Texture and Organic
Matter for Hydrologic Solutions, Soil Sci. Soc. Am. J. 70:1569–1578, tabela 1.
Zakres stosowania według autorów: ił do 60%, materia organiczna do 8% (wejścia są przycinane
do tego zakresu, a funkcja zwraca informację, że przycięcie nastąpiło).
Test: glina o 40% piasku, 20% iłu i 2,5% materii organicznej daje ok. 28% i 14% objętości.
"""
from __future__ import annotations

from dataclasses import dataclass

# Przelicznik węgla organicznego na materię organiczną (współczynnik van Bemmelena).
SOC_TO_OM = 1.724
OM_MAX_PCT = 8.0
CLAY_MAX_FRAC = 0.60


@dataclass(frozen=True)
class SoilWater:
    field_capacity: float  # θ przy 33 kPa [m3/m3]
    wilting_point: float   # θ przy 1500 kPa [m3/m3]
    clipped: bool = False  # czy wejścia wyszły poza zakres funkcji i zostały przycięte

    @property
    def available(self) -> float:
        """Woda dostępna dla roślin [m3/m3]."""
        return max(self.field_capacity - self.wilting_point, 0.0)


def organic_matter_pct_from_soc(soc_g_kg: float) -> float:
    """Materia organiczna [% wag.] z węgla organicznego [g/kg]."""
    return soc_g_kg / 10.0 * SOC_TO_OM


def saxton_rawls_2006(sand_frac: float, clay_frac: float, om_pct: float) -> SoilWater:
    """Pojemność polowa (33 kPa) i punkt więdnięcia (1500 kPa) [m3/m3].

    sand_frac, clay_frac – udział wagowy piasku i iłu jako ułamek (0–1)
    om_pct               – materia organiczna [% wag.]
    """
    clipped = False
    s = min(max(sand_frac, 0.0), 1.0)
    c = min(max(clay_frac, 0.0), 1.0)
    om = max(om_pct, 0.0)
    if c > CLAY_MAX_FRAC:
        c, clipped = CLAY_MAX_FRAC, True
    if s + c > 1.0:
        s = 1.0 - c
    if om > OM_MAX_PCT:
        om, clipped = OM_MAX_PCT, True

    theta_1500_t = (-0.024 * s + 0.487 * c + 0.006 * om + 0.005 * (s * om)
                    - 0.013 * (c * om) + 0.068 * (s * c) + 0.031)
    theta_1500 = theta_1500_t + (0.14 * theta_1500_t - 0.02)

    theta_33_t = (-0.251 * s + 0.195 * c + 0.011 * om + 0.006 * (s * om)
                  - 0.027 * (c * om) + 0.452 * (s * c) + 0.299)
    theta_33 = theta_33_t + (1.283 * theta_33_t ** 2 - 0.374 * theta_33_t - 0.015)

    wp = max(theta_1500, 0.005)
    fc = max(theta_33, wp)
    return SoilWater(field_capacity=fc, wilting_point=wp, clipped=clipped)


# Klasy uziarnienia USDA (trójkąt uziarnienia). Kolejność warunków ma znaczenie.
def usda_texture_class(sand_pct: float, silt_pct: float, clay_pct: float) -> str:
    """Klasa uziarnienia USDA dla udziałów w procentach (suma ok. 100)."""
    sand, silt, clay = sand_pct, silt_pct, clay_pct
    if silt + 1.5 * clay < 15:
        return "sand"
    if silt + 1.5 * clay >= 15 and silt + 2 * clay < 30:
        return "loamy sand"
    if (7 <= clay < 20 and sand > 52 and silt + 2 * clay >= 30) or (clay < 7 and silt < 50 and silt + 2 * clay >= 30):
        return "sandy loam"
    if 7 <= clay < 27 and 28 <= silt < 50 and sand <= 52:
        return "loam"
    if (silt >= 50 and 12 <= clay < 27) or (50 <= silt < 80 and clay < 12):
        return "silt loam"
    if silt >= 80 and clay < 12:
        return "silt"
    if 20 <= clay < 35 and silt < 28 and sand > 45:
        return "sandy clay loam"
    if 27 <= clay < 40 and 20 < sand <= 45:
        return "clay loam"
    if 27 <= clay < 40 and sand <= 20:
        return "silty clay loam"
    if clay >= 35 and sand > 45:
        return "sandy clay"
    if clay >= 40 and silt >= 40:
        return "silty clay"
    if clay >= 40 and sand <= 45 and silt < 40:
        return "clay"
    return "loam"  # punkty dokładnie na granicach klas


# Polskie nazwy klas USDA i klucz ilustracji warstwy (docs/assets/gleba/README.md: pięć ilustracji mineralnych).
USDA_LABELS_PL: dict[str, tuple[str, str]] = {
    "sand": ("piasek", "sand"),
    "loamy sand": ("piasek gliniasty", "sand"),
    "sandy loam": ("glina piaszczysta", "sandy_loam"),
    "loam": ("glina", "loam"),
    "silt loam": ("glina pylasta", "silt_loam"),
    "silt": ("pył", "silt_loam"),
    "sandy clay loam": ("glina piaszczysto-ilasta", "sandy_loam"),
    "clay loam": ("glina ilasta", "clay"),
    "silty clay loam": ("glina pylasto-ilasta", "clay"),
    "sandy clay": ("ił piaszczysty", "clay"),
    "silty clay": ("ił pylasty", "clay"),
    "clay": ("ił", "clay"),
}

# Woda łatwo odparowująca z powierzchni gleby REW [mm], FAO-56 tab. 19 (środek podanego zakresu).
# Tabela 19 nie ma klas: sandy clay loam, clay loam, sandy clay; przyjęto wartości klas sąsiednich.
REW_MM_BY_USDA: dict[str, float] = {
    "sand": 4.5, "loamy sand": 6.0, "sandy loam": 8.0, "loam": 9.0, "silt loam": 9.5, "silt": 9.5,
    "sandy clay loam": 9.0, "clay loam": 9.5, "silty clay loam": 9.5, "sandy clay": 10.0,
    "silty clay": 10.0, "clay": 10.0,
}
