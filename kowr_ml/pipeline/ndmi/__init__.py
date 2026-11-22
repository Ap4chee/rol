"""Model zmiany NDMI pola w horyzoncie 7–14 dni (docs/model_ndmi.md, docs/ml/specyfikacja_treningu.md).

Kroki (każdy zapisuje Parquet i pomija to, co już ma):
  python -m kowr_ml.pipeline.ndmi.fields       pola z ESA WorldCover 2021 (klasa 40) -> fields.parquet
  python -m kowr_ml.pipeline.ndmi.s2 12        sceny Sentinel-2 L2A, 12 procesów -> obs/<skupisko>_<rok>.parquet
  python -m kowr_ml.pipeline.ndmi.weather      archiwum Open-Meteo, komórka na skupisko -> weather.parquet
  python -m kowr_ml.pipeline.ndmi.dataset 12   cechy (runtime/features.py) i etykiety (labels.py) -> training.parquet
  python -m kowr_ml.pipeline.ndmi.train        ocena i model -> runs/<data>_<hash>/
Nowy przebieg trafia do aplikacji po skopiowaniu do kowr_ml/models/ndmi/ i wpisaniu w models/CURRENT.json.
"""
