"""Wilgotność warstw gleby w okolicy (model regionalny NASA POWER) na tle tych samych dni w poprzednich latach."""
from __future__ import annotations

from datetime import date

from app.config import HISTORY_YEARS
from app.core import soil_moisture as moisture_calc
from app.core.textfmt import fmt_date, plural_days
from app.presentation.sections.sources_info import MOISTURE_NO_IMPACT
from app.schemas import SoilMoistureLayer, SoilMoistureSection, SourceInfo, Status


def soil_moisture_section(series: dict[str, dict[date, float]] | None, info: SourceInfo, end: date,
                          balance_class: str | None) -> SoilMoistureSection:
    if series is None:
        return SoilMoistureSection(status=info.status, reason=info.reason, text=[MOISTURE_NO_IMPACT])
    layers = moisture_calc.compare_layers(series, end, HISTORY_YEARS)
    if not layers:
        reason = "Za mało lat z danymi o wilgotności warstw, żeby porównać je z poprzednimi latami."
        return SoilMoistureSection(status=Status.no_data, reason=reason, text=[MOISTURE_NO_IMPACT])
    out = [SoilMoistureLayer(
        key=layer.key, label=layer.label, top_cm=layer.top_cm, bottom_cm=layer.bottom_cm,
        current=round(layer.comparison.current, 3), current_to=layer.current_to,
        median=round(layer.comparison.median, 3), years_higher=layer.comparison.years_higher,
        years_compared=layer.comparison.years_compared, class_key=layer.comparison.class_key,
        class_label=moisture_calc.CLASS_LABELS[layer.comparison.class_key]) for layer in layers]
    text = [f"{layer.label.capitalize()}: {layer.class_label} (wilgotniej było w {layer.years_higher} z "
            f"{layer.years_compared} poprzednich lat)." for layer in out]
    agreement = moisture_calc.agreement_with_balance(layers, balance_class)
    if agreement:
        text.append(agreement)
    last = max(layer.current_to for layer in out)
    if last < end:
        text.append(f"Dane modelu kończą się {fmt_date(last)}, {plural_days((end - last).days)} przed ostatnim dniem analizy.")
    text.append("To model regionalny w siatce ok. 50 km: opisuje okolicę, a nie samą działkę. Wilgotność na działce "
                "liczy bilans wodny powyżej.")
    return SoilMoistureSection(status=Status.ok, layers=out, text=text)
