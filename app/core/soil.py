"""Gleba do bilansu: z warstw (uziarnienie, węgiel organiczny) do pojemności wodnej strefy korzeni.

Trzy warianty z SoilGrids: średnia oraz dwie granice przedziału zbudowane z kwantyli Q0.05 i Q0.95
(wariant lekki: najwięcej piasku i najmniej iłu; wariant ciężki: odwrotnie). Przedział jest szeroki,
bo to 90-procentowy przedział predykcji modelu globalnego, i tak jest pokazywany.
"""
from __future__ import annotations

from dataclasses import dataclass

from app.core.ptf import (
    REW_MM_BY_USDA,
    SoilWater,
    organic_matter_pct_from_soc,
    saxton_rawls_2006,
    usda_texture_class,
)

# Gleba umowna używana WYŁĄCZNIE wtedy, gdy nie ma danych o glebie; raport oznacza to wprost.
ASSUMED_SAND_PCT, ASSUMED_CLAY_PCT, ASSUMED_OM_PCT = 40.0, 20.0, 2.5


@dataclass
class Layer:
    top_cm: int
    bottom_cm: int
    sand_pct: float
    silt_pct: float
    clay_pct: float
    soc_g_kg: float | None = None
    bulk_density_g_cm3: float | None = None
    sand_q05_pct: float | None = None
    sand_q95_pct: float | None = None
    clay_q05_pct: float | None = None
    clay_q95_pct: float | None = None

    @property
    def thickness_cm(self) -> int:
        return self.bottom_cm - self.top_cm


@dataclass
class SoilVariant:
    key: str        # mean | light | heavy | assumed
    label: str
    fc_root: float  # pojemność polowa, średnia w strefie korzeni [m3/m3]
    wp_root: float  # punkt więdnięcia, średnia w strefie korzeni [m3/m3]
    fc_top: float   # warstwa powierzchniowa 0–10 cm (parowanie z gołej gleby)
    wp_top: float
    rew_mm: float
    clipped: bool = False


def layer_water(sand_pct: float, clay_pct: float, soc_g_kg: float | None) -> SoilWater:
    om = organic_matter_pct_from_soc(soc_g_kg) if soc_g_kg is not None else ASSUMED_OM_PCT
    return saxton_rawls_2006(sand_pct / 100.0, clay_pct / 100.0, om)


def _weighted(layers: list[Layer], depth_cm: float, values: list[tuple[float, float]]) -> tuple[float, float]:
    """Średnia ważona miąższością warstw w przedziale 0–depth_cm dla par (fc, wp)."""
    total = fc_sum = wp_sum = 0.0
    for layer, (fc, wp) in zip(layers, values):
        overlap = min(layer.bottom_cm, depth_cm) - min(layer.top_cm, depth_cm)
        if overlap <= 0:
            continue
        total += overlap
        fc_sum += fc * overlap
        wp_sum += wp * overlap
    if total <= 0:
        raise ValueError("brak warstw gleby w strefie korzeni")
    return fc_sum / total, wp_sum / total


def _variant(key: str, label: str, layers: list[Layer], root_depth_m: float,
             textures: list[tuple[float, float]]) -> SoilVariant:
    waters = [layer_water(sand, clay, layer.soc_g_kg) for layer, (sand, clay) in zip(layers, textures)]
    pairs = [(w.field_capacity, w.wilting_point) for w in waters]
    fc_root, wp_root = _weighted(layers, root_depth_m * 100.0, pairs)
    fc_top, wp_top = _weighted(layers, 10.0, pairs)
    sand0, clay0 = textures[0]
    texture = usda_texture_class(sand0, max(100.0 - sand0 - clay0, 0.0), clay0)
    return SoilVariant(key, label, fc_root, wp_root, fc_top, wp_top, REW_MM_BY_USDA[texture],
                       clipped=any(w.clipped for w in waters))


def _bounded(sand: float, clay: float) -> tuple[float, float]:
    sand = min(max(sand, 0.0), 100.0)
    clay = min(max(clay, 0.0), 100.0)
    if sand + clay > 100.0:
        scale = 100.0 / (sand + clay)
        sand, clay = sand * scale, clay * scale
    return sand, clay


def build_variants(layers: list[Layer], root_depth_m: float) -> list[SoilVariant]:
    """Warianty gleby do bilansu: średnia i dwie granice przedziału kwantyli (jeśli kwantyle są)."""
    variants = [_variant("mean", "średnia SoilGrids", layers, root_depth_m,
                         [(layer.sand_pct, layer.clay_pct) for layer in layers])]
    if all(v is not None for layer in layers
           for v in (layer.sand_q05_pct, layer.sand_q95_pct, layer.clay_q05_pct, layer.clay_q95_pct)):
        variants.append(_variant(
            "light", "granica lekka (najwięcej piasku, najmniej iłu w przedziale 5–95%)", layers, root_depth_m,
            [_bounded(layer.sand_q95_pct, layer.clay_q05_pct) for layer in layers]))
        variants.append(_variant(
            "heavy", "granica ciężka (najmniej piasku, najwięcej iłu w przedziale 5–95%)", layers, root_depth_m,
            [_bounded(layer.sand_q05_pct, layer.clay_q95_pct) for layer in layers]))
    return variants


def assumed_variant() -> SoilVariant:
    """Gleba umowna (glina: 40% piasku, 20% iłu, 2,5% materii organicznej), gdy brak danych o glebie."""
    water = saxton_rawls_2006(ASSUMED_SAND_PCT / 100.0, ASSUMED_CLAY_PCT / 100.0, ASSUMED_OM_PCT)
    return SoilVariant("assumed", "gleba umowna: glina (40% piasku, 20% iłu)", water.field_capacity,
                       water.wilting_point, water.field_capacity, water.wilting_point, REW_MM_BY_USDA["loam"])
