"""Parametry pilotażu. Zmiana progu albo okna wymaga tylko ponownego przeliczenia dataset.py."""
from __future__ import annotations

import os
from pathlib import Path

DATA_DIR = Path(os.environ.get("KOWR_ML_DATA", Path(__file__).resolve().parent / "data"))
RUNS_DIR = Path(os.environ.get("KOWR_ML_RUNS", Path(__file__).resolve().parent / "runs"))

# Skupiska pól: (nazwa, szer. N, dł. E) w EPSG:4326. Rozrzucone po regionach rolniczych Polski,
# z dala od działki demo 580/2 (Niedrzwica Kościelna, 51,09 N 22,36 E), która zostaje poza treningiem.
CLUSTERS: list[tuple[str, float, float]] = [
    ("koscian", 52.08, 16.65),
    ("gniezno", 52.55, 17.70),
    ("inowroclaw", 52.75, 18.20),
    ("zulawy", 54.15, 19.10),
    ("ketrzyn", 54.05, 21.40),
    ("wysokie_maz", 52.90, 22.50),
    ("plonsk", 52.60, 20.40),
    ("kutno", 52.25, 19.35),
    ("sochaczew", 52.20, 20.20),
    ("hrubieszow", 50.80, 23.85),
    ("biala_podlaska", 52.05, 23.15),
    ("sandomierz", 50.65, 21.70),
    ("glubczyce", 50.20, 17.80),
    ("strzelin", 50.78, 17.05),
    ("pyrzyce", 53.15, 14.90),
    ("chelmno", 53.35, 18.45),
    ("koszalin", 54.10, 16.30),
    ("miechow", 50.35, 20.00),
    ("przeworsk", 50.05, 22.50),
    ("kalisz", 51.75, 18.10),
]
# Skupiska odłożone w całości na test przestrzenny (nie biorą udziału w treningu ani strojeniu).
TEST_CLUSTERS = ("gniezno", "biala_podlaska", "glubczyce", "pyrzyce")
# Sezon odłożony na test czasowy.
TEST_SEASON = 2025
SEASONS = tuple(range(2019, 2026))

CLUSTER_HALF_SIZE_M = 3000      # skupisko to kwadrat 6 × 6 km
FIELD_SIZE_M = 80               # pole pilotażowe: kwadrat 80 × 80 m w EPSG:2180 (ok. 16 środków pikseli 20 m)
FIELD_SPACING_M = 250           # odstęp siatki kandydatów
FIELD_MIN_CROPLAND = 0.95       # udział pikseli WorldCover klasy 40 wewnątrz pola
FIELDS_PER_CLUSTER = 150
RANDOM_SEED = 2026

# Sentinel-2 (zgodnie ze specyfikacją, sekcja 3)
STAC_URL = "https://earth-search.aws.element84.com/v1"
S2_COLLECTION = "sentinel-2-c1-l2a"
S2_MONTHS = ("03-01", "10-31")  # zakres dat pobierania scen w sezonie
SCL_VEGETATION = 4
MIN_PIXELS = 6
MIN_COVERAGE = 0.65
MIN_DENOMINATOR = 1e-6

# Etykieta i dni prognozy
ISSUE_FIRST = "04-01"
ISSUE_LAST = "10-15"
ISSUE_STEP_DAYS = 7
LAST_WINDOW_DAYS = (1, 14)      # obserwacja bazowa w t-14 … t-1
TARGET_WINDOW_DAYS = (7, 14)    # obserwacja docelowa w t+7 … t+14
# Poprzednia obserwacja (do trendu): najnowsza 7–30 dni przed bazową. Dolna granica 7 dni odpowiada
# wyborowi scen w aplikacji (app/sources/sentinel.py, choose_for_indices: sceny co najmniej 7 dni od siebie).
TREND_WINDOW_DAYS = (7, 30)

# Pogoda: te same parametry co aplikacja (app/sources/weather.py)
OPEN_METEO_ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
OPEN_METEO_DAILY = "precipitation_sum,et0_fao_evapotranspiration,temperature_2m_max,temperature_2m_min"
WEATHER_START = "2018-10-01"    # rozgrzewka bilansu referencyjnego przed pierwszym sezonem
WEATHER_END = "2025-12-31"

# Referencyjny bilans wiadra (FAO-56, Kc = 1): wskaźnik suchości niezależny od gleby i uprawy,
# bo w treningu nie znamy ani jednej, ani drugiej. Nie jest to bilans działki z aplikacji.
REF_TAW_MM = 100.0
REF_P = 0.5

WORLDCOVER_URL = ("https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/"
                  "ESA_WorldCover_10m_2021_v200_{tile}_Map.tif")
WORLDCOVER_CROPLAND = 40
