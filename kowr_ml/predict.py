"""Stara ścieżka używana przez app/report.py. Tylko dla zgodności; do usunięcia po scaleniu refaktoru backendu."""
from kowr_ml.runtime.ndmi import NdmiForecaster, in_season  # noqa: F401

predict = NdmiForecaster.default().predict
