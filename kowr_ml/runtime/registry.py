"""Które pliki modeli obsługują aplikację i jak je wczytać.

Wdrożone przebiegi są przypięte w kowr_ml/models/CURRENT.json (ścieżki względem kowr_ml/models). Nowy przebieg
z runs/ trafia do aplikacji dopiero po skopiowaniu do models/ i zmianie tego pliku. Zmienne środowiskowe
KOWR_ML_MODEL_DIR (NDMI) i KOWR_SM_MODEL_DIR (wilgotność) wskazują inny katalog bez zmiany repozytorium.
"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

ModelKind = Literal["ndmi", "soil_moisture"]

MODELS_DIR = Path(__file__).resolve().parents[1] / "models"
PINNED_FILE = MODELS_DIR / "CURRENT.json"
MODEL_DIR_ENV: dict[ModelKind, str] = {"ndmi": "KOWR_ML_MODEL_DIR", "soil_moisture": "KOWR_SM_MODEL_DIR"}


def model_dir(kind: ModelKind) -> Path:
    """Katalog przebiegu dla aplikacji: ze zmiennej środowiskowej, a bez niej przypięty w CURRENT.json."""
    override = os.environ.get(MODEL_DIR_ENV[kind])
    if override:
        return Path(override)
    pinned = json.loads(PINNED_FILE.read_text(encoding="utf-8"))
    return MODELS_DIR / pinned[kind]


def is_installed(directory: Path) -> bool:
    return (directory / "model.joblib").exists()


@dataclass(frozen=True)
class ModelBundle:
    """Zawartość katalogu przebiegu: estymatory z listą cech (model.joblib) i karta modelu."""
    estimators: dict
    card: dict

    @classmethod
    def load(cls, directory: Path) -> ModelBundle:
        import joblib  # dopiero tutaj: bez pliku modelu aplikacja nie potrzebuje scikit-learn

        return cls(joblib.load(directory / "model.joblib"),
                   json.loads((directory / "model_card.json").read_text(encoding="utf-8")))

    @property
    def features(self) -> list[str]:
        return self.estimators["features"]
