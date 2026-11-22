"""Stałe konfiguracyjne: ścieżki, limity czasu, nagłówki. Bez sekretów (żadne źródło nie wymaga klucza)."""
from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STATIC_DIR = ROOT / "static"
SOIL_ASSETS_DIR = ROOT / "docs" / "assets" / "gleba" / "webp"
CACHE_DIR = Path(os.environ.get("KOWR_CACHE_DIR", ROOT / "cache"))
# dane użytkowników (zapisane pola); w odróżnieniu od cache/ nie wolno ich kasować
DATA_DIR = Path(os.environ.get("KOWR_DATA_DIR", ROOT / "data"))

# Nagłówek identyfikujący aplikację wobec zewnętrznych usług (bez danych osobowych).
USER_AGENT = "kowr-retencja-hackathon/0.1 (prototyp niekomercyjny)"

# Limity czasu pojedynczych źródeł [s]. Suma najdłuższej równoległej gałęzi ma zostawić zapas do 30 s.
TIMEOUT_ULDK_S = 6.0
TIMEOUT_WEATHER_ARCHIVE_S = 12.0
TIMEOUT_WEATHER_POWER_S = 20.0
TIMEOUT_WEATHER_RECENT_S = 8.0
TIMEOUT_SOIL_REST_S = 14.0  # pełne zapytanie REST trwało 11,8 s (pomiar 21.11.2026)
TIMEOUT_SOIL_TOTAL_S = 22.0
# Satelita: tyle raport czeka na zdjęcia; niedokończone pobieranie trwa w tle (GET /api/satellite).
SATELLITE_INLINE_BUDGET_S = 14.0
SATELLITE_DEFERRED_BUDGET_S = 100.0
TIMEOUT_HYDRO_S = 8.0
TIMEOUT_TERRAIN_S = 180.0  # WCS z NMT odpowiadał w 13-120 s (pomiary 21.11.2026)

# Ile lat wstecz od daty analizy: 10 sezonów do porównań + 12 miesięcy rozbiegu bilansu.
HISTORY_YEARS = 10
WARMUP_DAYS = 400

# Wymuszanie awarii źródeł do testów odporności, np. KOWR_FAIL=weather_archive,soil
# Dozwolone: uldk, egib_wfs, weather_archive, weather_power, weather_recent, soil_wcs, soil_rest, soil_vrt,
#            satellite, hydrology, terrain, soil_moisture
FORCED_FAILURES = {s.strip() for s in os.environ.get("KOWR_FAIL", "").split(",") if s.strip()}


class ForcedFailure(RuntimeError):
    """Sztuczna awaria źródła włączona zmienną KOWR_FAIL."""


def check_forced_failure(key: str) -> None:
    if key in FORCED_FAILURES:
        raise ForcedFailure(f"wymuszona awaria źródła ({key}) – test odporności")
