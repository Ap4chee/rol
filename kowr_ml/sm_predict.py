"""Stara ścieżka używana przez app/report.py. Tylko dla zgodności; do usunięcia po scaleniu refaktoru backendu."""
from kowr_ml.runtime.soil_moisture import SoilMoistureForecaster

predict = SoilMoistureForecaster.default().predict
