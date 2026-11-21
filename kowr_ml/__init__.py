"""Trening i predykcja modelu zmiany NDMI pola w horyzoncie 7–14 dni (specyfikacja_treningu_ml_kowr.md).

Etapy (każdy zapisuje Parquet i pomija to, co już ma):
  fields.py   – pola pilotażowe z ESA WorldCover 2021 (klasa 40, grunty orne) -> fields.parquet
  s2.py       – Sentinel-2 L2A z Earth Search, pętla po scenach -> obs/<skupisko>_<rok>.parquet
  weather.py  – archiwum Open-Meteo, jedna komórka na skupisko -> weather.parquet
  dataset.py  – etykiety i cechy (features.py) -> training.parquet
  train.py    – HistGradientBoosting + baseline'y -> runs/<id>/
  predict.py  – predykcja dla pola i daty, używana przez backend
"""
