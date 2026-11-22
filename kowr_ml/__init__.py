"""Modele ML aplikacji KOWR: zmiana NDMI pola na t+7 … t+14 i zmiana wilgotności gleby 0–100 cm na t … t+13.

  runtime/      to, czego używa aplikacja (numpy, scikit-learn, joblib): cechy, przypięte modele, predykcja
  pipeline/     pobieranie danych, tabele treningowe i trening (dodatkowo requirements-ml.txt)
  experiments/  porównania, które nie trafiły do aplikacji (sieć GRU)
  models/       wdrożone przebiegi; które z nich działają, mówi models/CURRENT.json

Kolejność kroków treningu jest w docstringach pipeline/ndmi/__init__.py i pipeline/soil_moisture/__init__.py.
"""
from kowr_ml.runtime.ndmi import NdmiForecaster
from kowr_ml.runtime.soil_moisture import SoilMoistureForecaster

__all__ = ["NdmiForecaster", "SoilMoistureForecaster"]
