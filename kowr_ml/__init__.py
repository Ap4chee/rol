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

Model wilgotności gleby 0–100 cm (ERA5-Land) na dni t … t+13:
  sm_dataset.py – cechy i etykiety z era5_land_sm.parquet i era5_weather.parquet -> training_sm.parquet
  sm_train.py   – trening bazowej wersji -> runs/<id>_sm_<hash>/
Wersja 2 tego modelu (v1 zostaje bez zmian):
  ifs.py          – archiwalne prognozy ECMWF IFS (open data na AWS) -> ifs_forecast.parquet
  static.py       – gleba (SoilGrids) i teren (NMT GUGiK) skupisk funkcjami aplikacji -> cluster_static.parquet
  sm2_dataset.py  – wiersze v1 + prognoza + gleba i teren -> training_sm2.parquet
  sm2_train.py    – trening v2 z porównaniem wariantów -> runs/<id>_sm2_<hash>/
Wersja 3 (w aplikacji): sm3_dataset.py, sm2_train.py v3 i sm_predict.py.
"""
