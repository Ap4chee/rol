"""Trening i predykcja modelu zmiany NDMI pola w horyzoncie 7–14 dni (specyfikacja_treningu_ml_kowr.md).

Etapy (każdy zapisuje Parquet i pomija to, co już ma; katalog danych: KOWR_ML_DATA, domyślnie kowr_ml/data):
  fields.py   – pola pilotażowe z ESA WorldCover 2021 (klasa 40, grunty orne) -> fields.parquet
  s2.py       – Sentinel-2 L2A z Earth Search (obie kolekcje jak w aplikacji), pętla po scenach
                -> obs/<skupisko>_<rok>.parquet
  weather.py  – archiwum Open-Meteo, jedna komórka na skupisko -> weather.parquet
  dataset.py  – etykiety i cechy (features.py) -> training.parquet
  train.py    – HistGradientBoosting, ocena na nowych miejscach i nieznanym sezonie, punkty odniesienia -> runs/<id>/
  predict.py  – predykcja dla działki i daty, używana przez backend
  features.py – cechy wspólne dla treningu i aplikacji (testy: tests/test_ml_features.py)
  train_gru.py – porównawcza sieć GRU z pierwszej wersji modelu (PyTorch, poza zależnościami aplikacji)

Kolejność: python -m kowr_ml.fields, .s2, .weather, .dataset, .train.
"""
