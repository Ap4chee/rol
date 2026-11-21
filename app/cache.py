"""Trwała pamięć podręczna odpowiedzi zewnętrznych usług: pliki JSON w katalogu `cache/`.

Klucz to zwykły napis (np. komórka siatki i zakres dat). Nazwa pliku to jego skrót,
a sam klucz jest zapisany w pliku, żeby dało się sprawdzić, co w nim leży.
"""
from __future__ import annotations

import hashlib
import json
import time
from pathlib import Path
from typing import Any

from app.config import CACHE_DIR


def _path(namespace: str, key: str) -> Path:
    digest = hashlib.sha1(key.encode("utf-8")).hexdigest()[:24]
    return CACHE_DIR / namespace / f"{digest}.json"


def get(namespace: str, key: str, max_age_s: float | None = None) -> Any | None:
    """Zwraca zapisaną wartość albo None. `max_age_s` ogranicza wiek wpisu."""
    path = _path(namespace, key)
    try:
        with path.open("r", encoding="utf-8") as fh:
            entry = json.load(fh)
    except (OSError, ValueError):
        return None
    if entry.get("key") != key:
        return None
    if max_age_s is not None and time.time() - float(entry.get("saved_at", 0)) > max_age_s:
        return None
    return entry.get("value")


def put(namespace: str, key: str, value: Any) -> None:
    """Zapisuje wartość. Błąd zapisu nie przerywa raportu (cache jest tylko przyspieszeniem)."""
    path = _path(namespace, key)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        with tmp.open("w", encoding="utf-8") as fh:
            json.dump({"key": key, "saved_at": time.time(), "value": value}, fh, ensure_ascii=False)
        tmp.replace(path)
    except OSError:
        pass
