"""Sekcja „Gleba”: warstwy z SoilGrids z klasą uziarnienia, wodą dostępną i ilustracją."""
from __future__ import annotations

from app.core.crops import Crop
from app.core.ptf import USDA_LABELS_PL, usda_texture_class
from app.core.soil import Layer, layer_water
from app.presentation.sections.sources_info import SOIL_ASSUMED_IMPACT
from app.presentation.textfmt import fmt
from app.schemas import SoilLayer, SoilSection, SourceInfo, Status
from app.sources import soilgrids

HIGH_SOC_G_KG = 120.0  # powyżej tej zawartości węgla gleba może być organiczna (torfowa, murszowa)
ORGANIC_CHECK_LAYERS = 3   # sprawdzamy wierzchnie warstwy do 30 cm


def soil_layer(layer: Layer) -> SoilLayer:
    usda = usda_texture_class(layer.sand_pct, layer.silt_pct, layer.clay_pct)
    label, image_key = USDA_LABELS_PL[usda]
    water = layer_water(layer.sand_pct, layer.clay_pct, layer.soc_g_kg)
    has_range = layer.sand_q05_pct is not None and layer.clay_q05_pct is not None
    return SoilLayer(
        top_cm=layer.top_cm, bottom_cm=layer.bottom_cm, sand_pct=round(layer.sand_pct, 1),
        silt_pct=round(layer.silt_pct, 1), clay_pct=round(layer.clay_pct, 1),
        soc_g_kg=round(layer.soc_g_kg, 1) if layer.soc_g_kg is not None else None,
        bulk_density_g_cm3=round(layer.bulk_density_g_cm3, 2) if layer.bulk_density_g_cm3 is not None else None,
        sand_pct_range=[round(layer.sand_q05_pct), round(layer.sand_q95_pct)] if has_range else None,
        clay_pct_range=[round(layer.clay_q05_pct), round(layer.clay_q95_pct)] if has_range else None,
        texture_key=image_key, texture_usda=usda, texture_label=label,
        image=f"/soil-assets/{image_key.replace('_', '-')}.webp",
        field_capacity_vol_pct=round(water.field_capacity * 100, 1),
        wilting_point_vol_pct=round(water.wilting_point * 100, 1),
        available_water_mm=round(water.available * layer.thickness_cm * 10.0))


def soil_section(data: soilgrids.SoilData | None, info: SourceInfo, crop: Crop) -> SoilSection:
    if data is None:
        return SoilSection(status=info.status, reason=info.reason, assumed=True, root_depth_m=crop.root_depth_m,
                           text=[SOIL_ASSUMED_IMPACT])
    layers = [soil_layer(layer) for layer in data.layers]
    top = layers[0]
    root_cm = crop.root_depth_m * 100
    root_water = sum(
        layer.available_water_mm * (min(layer.bottom_cm, root_cm) - layer.top_cm) / (layer.bottom_cm - layer.top_cm)
        for layer in layers if layer.top_cm < root_cm)
    text = [
        f"Wierzchnia warstwa to {top.texture_label} (piasek {fmt(top.sand_pct)}%, pył {fmt(top.silt_pct)}%, "
        f"ił {fmt(top.clay_pct)}%). W strefie korzeni do {fmt(crop.root_depth_m, 1)} m taka gleba może utrzymać "
        f"ok. {fmt(root_water)} mm wody dostępnej dla roślin.",
        f"Wartości pochodzą z mapy SoilGrids w siatce 250 m (liczba komórek pod działką: {data.cells}, średnia ważona "
        "powierzchnią). To szacunek z modelu globalnego: na pojedynczym polu gleba może być wyraźnie lżejsza albo "
        "cięższa, co pokazuje przedział 5–95%.",
    ]
    if any(layer.soc_g_kg is not None and layer.soc_g_kg > HIGH_SOC_G_KG for layer in layers[:ORGANIC_CHECK_LAYERS]):
        text.append("Mapa pokazuje bardzo dużo węgla organicznego: to może być gleba organiczna (torfowa lub murszowa). "
                    "Użyta funkcja przeliczeniowa dotyczy gleb mineralnych, więc pojemność wodna jest tu niepewna.")
    return SoilSection(status=Status.ok, assumed=False, cells=data.cells, method=data.method_label,
                       root_depth_m=crop.root_depth_m, layers=layers, text=text)
