"""Stałe konfiguracyjne: ścieżki, limity czasu, nagłówki. Bez sekretów (żadne źródło nie wymaga klucza)."""
from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STATIC_DIR = ROOT / "static"
CACHE_DIR = Path(os.environ.get("KOWR_CACHE_DIR", ROOT / "cache"))

# Nagłówek identyfikujący aplikację wobec zewnętrznych usług (bez danych osobowych).
USER_AGENT = "kowr-retencja-hackathon/0.1 (prototyp niekomercyjny)"

# Limity czasu pojedynczych źródeł [s]. Suma najdłuższej równoległej gałęzi ma zostawić zapas do 30 s.
TIMEOUT_ULDK_S = 6.0
TIMEOUT_WEATHER_ARCHIVE_S = 12.0
TIMEOUT_WEATHER_POWER_S = 20.0
TIMEOUT_WEATHER_RECENT_S = 8.0
TIMEOUT_SOIL_REST_S = 8.0
TIMEOUT_SOIL_TOTAL_S = 22.0
TIMEOUT_SATELLITE_S = 24.0
TIMEOUT_HYDRO_S = 8.0
TIMEOUT_TERRAIN_S = 45.0

# Ile lat wstecz od daty analizy: 10 sezonów do porównań + 12 miesięcy rozbiegu bilansu.
HISTORY_YEARS = 10
WARMUP_DAYS = 400

# Wymuszanie awarii źródeł do testów odporności, np. KOWR_FAIL=weather_archive,soil
# Dozwolone: uldk, weather_archive, weather_power, weather_recent, soil_rest, soil_vrt, satellite, hydrology, terrain
FORCED_FAILURES = {s.strip() for s in os.environ.get("KOWR_FAIL", "").split(",") if s.strip()}


class ForcedFailure(RuntimeError):
    """Sztuczna awaria źródła włączona zmienną KOWR_FAIL."""


def check_forced_failure(key: str) -> None:
    if key in FORCED_FAILURES:
        raise ForcedFailure(f"wymuszona awaria źródła ({key}) – test odporności")
