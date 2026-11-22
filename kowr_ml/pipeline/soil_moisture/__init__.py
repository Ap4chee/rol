"""Model zmiany wilgotności gleby 0–100 cm (ERA5-Land) na dni t … t+13, wersja v3 wdrożona w aplikacji.

Kroki:
  eksport plików Open-Meteo (s3://openmeteo) do era5_land_sm.parquet i era5_weather.parquet (skrypt poza repo)
  python -m kowr_ml.pipeline.soil_moisture.ifs       archiwalne prognozy ECMWF IFS -> ifs_forecast.parquet
  python -m kowr_ml.pipeline.soil_moisture.static    gleba i teren skupisk -> cluster_static.parquet
  python -m kowr_ml.pipeline.soil_moisture.dataset   tabela treningowa -> training_sm3.parquet
  python -m kowr_ml.pipeline.soil_moisture.train     ocena i model -> runs/<data>_sm3_<hash>/
Nowy przebieg trafia do aplikacji po skopiowaniu do kowr_ml/models/soil_moisture/ i wpisaniu w models/CURRENT.json.
"""
