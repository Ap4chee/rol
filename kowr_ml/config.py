"""Parametry zbioru i treningu. Zmiana progu albo okna wymaga tylko ponownego przeliczenia dataset.py."""
from __future__ import annotations

import os
from pathlib import Path

DATA_DIR = Path(os.environ.get("KOWR_ML_DATA", Path(__file__).resolve().parent / "data"))
RUNS_DIR = Path(os.environ.get("KOWR_ML_RUNS", Path(__file__).resolve().parent / "runs"))

# Skupiska pól: (nazwa, szer. N, dł. E) w EPSG:4326. Trzy grupy, bo powstawały w trzech krokach:
#   CLUSTERS_FIRST – 20 skupisk pierwszego modelu (regiony rolnicze, z dala od działki demo 580/2),
#   CLUSTERS_MORE  – 26 dodatkowych, w tym okolica działki demo (Niedrzwica Kościelna, 51,09 N 22,36 E),
#   CLUSTERS_GRID  – regularna siatka na całą Polskę: punkt co 0,45° szerokości i 0,7° długości (ok. 50 km),
#                    wewnątrz granicy kraju i co najmniej 12 km od skupisk z dwóch pierwszych grup.
CLUSTERS_FIRST: list[tuple[str, float, float]] = [
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
CLUSTERS_MORE: list[tuple[str, float, float]] = [
    ("niedrzwica", 51.09, 22.36),
    ("slupsk", 54.45, 17.20),
    ("suwalki", 54.15, 22.95),
    ("lomza", 53.15, 22.10),
    ("ciechanow", 52.90, 20.65),
    ("siedlce", 52.20, 22.30),
    ("radom", 51.35, 21.05),
    ("piotrkow", 51.40, 19.60),
    ("sieradz", 51.60, 18.75),
    ("rawicz", 51.62, 16.90),
    ("legnica", 51.20, 16.25),
    ("nysa", 50.50, 17.30),
    ("klobuck", 50.95, 18.95),
    ("busko", 50.45, 20.75),
    ("zamosc", 50.70, 23.25),
    ("tarnow", 50.15, 21.00),
    ("zlotow", 53.40, 17.05),
    ("szamotuly", 52.60, 16.55),
    ("kolo", 52.20, 18.60),
    ("tczew", 53.95, 18.55),
    ("lidzbark", 54.10, 20.55),
    ("dzialdowo", 53.25, 20.20),
    ("gryfice", 53.90, 15.20),
    ("sokolka", 53.20, 23.30),
    ("chelm", 51.15, 23.45),
    ("swiebodzin", 52.30, 15.50),
]
CLUSTERS_GRID: list[tuple[str, float, float]] = [
    ("g4970_1920", 49.7, 19.2), ("g4970_1990", 49.7, 19.9), ("g4970_2060", 49.7, 20.6), ("g4970_2130", 49.7, 21.3),
    ("g4970_2200", 49.7, 22.0), ("g5015_1850", 50.15, 18.5), ("g5015_1920", 50.15, 19.2), ("g5015_1990", 50.15, 19.9),
    ("g5015_2060", 50.15, 20.6), ("g5015_2130", 50.15, 21.3), ("g5015_2200", 50.15, 22.0), ("g5015_2270", 50.15, 22.7),
    ("g5060_1640", 50.6, 16.4), ("g5060_1710", 50.6, 17.1), ("g5060_1780", 50.6, 17.8), ("g5060_1850", 50.6, 18.5),
    ("g5060_1920", 50.6, 19.2), ("g5060_1990", 50.6, 19.9), ("g5060_2060", 50.6, 20.6), ("g5060_2130", 50.6, 21.3),
    ("g5060_2200", 50.6, 22.0), ("g5060_2270", 50.6, 22.7), ("g5060_2340", 50.6, 23.4), ("g5105_1570", 51.05, 15.7),
    ("g5105_1640", 51.05, 16.4), ("g5105_1710", 51.05, 17.1), ("g5105_1780", 51.05, 17.8), ("g5105_1850", 51.05, 18.5),
    ("g5105_1920", 51.05, 19.2), ("g5105_1990", 51.05, 19.9), ("g5105_2060", 51.05, 20.6), ("g5105_2130", 51.05, 21.3),
    ("g5105_2200", 51.05, 22.0), ("g5105_2270", 51.05, 22.7), ("g5150_1500", 51.5, 15.0), ("g5150_1570", 51.5, 15.7),
    ("g5150_1640", 51.5, 16.4), ("g5150_1710", 51.5, 17.1), ("g5150_1780", 51.5, 17.8), ("g5150_1850", 51.5, 18.5),
    ("g5150_1920", 51.5, 19.2), ("g5150_1990", 51.5, 19.9), ("g5150_2060", 51.5, 20.6), ("g5150_2130", 51.5, 21.3),
    ("g5150_2200", 51.5, 22.0), ("g5150_2270", 51.5, 22.7), ("g5150_2340", 51.5, 23.4), ("g5195_1500", 51.95, 15.0),
    ("g5195_1570", 51.95, 15.7), ("g5195_1640", 51.95, 16.4), ("g5195_1710", 51.95, 17.1), ("g5195_1780", 51.95, 17.8),
    ("g5195_1850", 51.95, 18.5), ("g5195_1920", 51.95, 19.2), ("g5195_1990", 51.95, 19.9), ("g5195_2060", 51.95, 20.6),
    ("g5195_2130", 51.95, 21.3), ("g5195_2200", 51.95, 22.0), ("g5195_2270", 51.95, 22.7), ("g5195_2340", 51.95, 23.4),
    ("g5240_1500", 52.4, 15.0), ("g5240_1570", 52.4, 15.7), ("g5240_1640", 52.4, 16.4), ("g5240_1710", 52.4, 17.1),
    ("g5240_1780", 52.4, 17.8), ("g5240_1850", 52.4, 18.5), ("g5240_1920", 52.4, 19.2), ("g5240_1990", 52.4, 19.9),
    ("g5240_2060", 52.4, 20.6), ("g5240_2130", 52.4, 21.3), ("g5240_2200", 52.4, 22.0), ("g5240_2270", 52.4, 22.7),
    ("g5285_1500", 52.85, 15.0), ("g5285_1570", 52.85, 15.7), ("g5285_1640", 52.85, 16.4), ("g5285_1710", 52.85, 17.1),
    ("g5285_1780", 52.85, 17.8), ("g5285_1850", 52.85, 18.5), ("g5285_1920", 52.85, 19.2), ("g5285_1990", 52.85, 19.9),
    ("g5285_2130", 52.85, 21.3), ("g5285_2200", 52.85, 22.0), ("g5285_2270", 52.85, 22.7), ("g5285_2340", 52.85, 23.4),
    ("g5330_1500", 53.3, 15.0), ("g5330_1570", 53.3, 15.7), ("g5330_1640", 53.3, 16.4), ("g5330_1780", 53.3, 17.8),
    ("g5330_1920", 53.3, 19.2), ("g5330_1990", 53.3, 19.9), ("g5330_2060", 53.3, 20.6), ("g5330_2130", 53.3, 21.3),
    ("g5330_2200", 53.3, 22.0), ("g5330_2270", 53.3, 22.7), ("g5330_2340", 53.3, 23.4), ("g5375_1500", 53.75, 15.0),
    ("g5375_1570", 53.75, 15.7), ("g5375_1640", 53.75, 16.4), ("g5375_1710", 53.75, 17.1), ("g5375_1780", 53.75, 17.8),
    ("g5375_1850", 53.75, 18.5), ("g5375_1920", 53.75, 19.2), ("g5375_1990", 53.75, 19.9), ("g5375_2060", 53.75, 20.6),
    ("g5375_2130", 53.75, 21.3), ("g5375_2200", 53.75, 22.0), ("g5375_2270", 53.75, 22.7), ("g5375_2340", 53.75, 23.4),
    ("g5420_1570", 54.2, 15.7), ("g5420_1640", 54.2, 16.4), ("g5420_1710", 54.2, 17.1), ("g5420_1780", 54.2, 17.8),
    ("g5420_1850", 54.2, 18.5), ("g5420_1990", 54.2, 19.9), ("g5420_2130", 54.2, 21.3), ("g5420_2200", 54.2, 22.0),
    ("g5420_2270", 54.2, 22.7), ("g5465_1780", 54.65, 17.8),
]
# Pola losujemy osobnym generatorem dla każdej z grup poniżej (to samo ziarno), bo tak powstał zbiór:
# dwie pierwsze listy w jednym przebiegu, siatka w drugim.
CLUSTER_GROUPS: list[list[tuple[str, float, float]]] = [CLUSTERS_FIRST + CLUSTERS_MORE, CLUSTERS_GRID]
CLUSTERS: list[tuple[str, float, float]] = CLUSTERS_FIRST + CLUSTERS_MORE + CLUSTERS_GRID

# Sezony. 2016 nie ma scen L2A w Earth Search; 2017 jest niepełny (ok. 30 scen na obszar).
SEASONS = tuple(range(2017, 2027))
# Ocena: foldy po skupisku (nowe miejsce) oraz sezon odłożony w całości (nowe miejsce i nieznany sezon).
CV_FOLDS = 5
SEASON_CV_FOLDS = 3
# Podział pierwszego modelu (20 skupisk, 2019–2025); używa go jeszcze porównawcza sieć GRU (train_gru.py).
TEST_CLUSTERS = ("gniezno", "biala_podlaska", "glubczyce", "pyrzyce")
TEST_SEASON = 2025

CLUSTER_HALF_SIZE_M = 3000      # skupisko to kwadrat 6 × 6 km
FIELD_SIZE_M = 80               # pole pilotażowe: kwadrat 80 × 80 m w EPSG:2180 (ok. 16 środków pikseli 20 m)
FIELD_SPACING_M = 250           # odstęp siatki kandydatów
FIELD_MIN_CROPLAND = 0.95       # udział pikseli WorldCover klasy 40 wewnątrz pola
FIELDS_PER_CLUSTER = 150
RANDOM_SEED = 2026

# Sentinel-2: te same kolekcje i zasady co aplikacja (app/sources/sentinel.py)
STAC_URL = "https://earth-search.aws.element84.com/v1"
S2_COLLECTIONS = ("sentinel-2-c1-l2a", "sentinel-2-l2a")   # pierwsza ma pierwszeństwo przy tej samej scenie
S2_COLLECTION = S2_COLLECTIONS[0]
S2_MONTHS = ("03-01", "10-31")  # zakres dat pobierania scen w sezonie
SCL_VEGETATION = 4
SCL_BARE_SOIL = 5
SCL_CLOUDY = (3, 8, 9, 10)      # cień chmur, chmury, cirrus
MIN_PIXELS = 6
MIN_COVERAGE = 0.65
MIN_DENOMINATOR = 1e-6
APP_WINDOW_DAYS = 45            # okno scen w aplikacji; cechy z historii zdjęć nie sięgają dalej

# Etykieta i dni prognozy
ISSUE_FIRST = "04-01"
ISSUE_LAST = "10-15"
ISSUE_STEP_DAYS = 7
LAST_WINDOW_DAYS = (1, 14)      # obserwacja bazowa w t-14 … t-1
TARGET_WINDOW_DAYS = (7, 14)    # obserwacja docelowa w t+7 … t+14
# Poprzednia obserwacja (do trendu): najnowsza 7–30 dni przed bazową. Dolna granica 7 dni odpowiada
# wyborowi scen w aplikacji (app/sources/sentinel.py, choose_for_indices: sceny co najmniej 7 dni od siebie).
TREND_WINDOW_DAYS = (7, 30)
SCENE_SPACING_DAYS = 7

# Pogoda: te same parametry co aplikacja (app/sources/weather.py)
OPEN_METEO_ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
OPEN_METEO_DAILY = "precipitation_sum,et0_fao_evapotranspiration,temperature_2m_max,temperature_2m_min"
WEATHER_START = "2016-10-01"    # rozgrzewka bilansu referencyjnego przed pierwszym sezonem
WEATHER_END = "2026-11-10"

# Referencyjny bilans wiadra (FAO-56, Kc = 1): wskaźnik suchości niezależny od gleby i uprawy,
# bo w treningu nie znamy ani jednej, ani drugiej. Nie jest to bilans działki z aplikacji.
REF_TAW_MM = 100.0
REF_P = 0.5
GDD_BASE_C = 5.0                # próg sumy temperatur efektywnych

WORLDCOVER_URL = ("https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/"
                  "ESA_WorldCover_10m_2021_v200_{tile}_Map.tif")
WORLDCOVER_CROPLAND = 40
