"""Etykieta modelu NDMI i kalendarz dni prognozy w tabeli treningowej. Bez pandas (testy: tests/test_ml_features.py).

Etykieta: NDMI pierwszej zaakceptowanej sceny z t+7 … t+14 (spec. sekcja 1); cechy z t-1 i wcześniej są
w kowr_ml/runtime/features.py, wspólne z predykcją.
"""
from __future__ import annotations

from datetime import date, timedelta

import numpy as np

from kowr_ml.pipeline import config as C
from kowr_ml.runtime.config import TARGET_WINDOW_DAYS
from kowr_ml.runtime.features import FieldScenes


def target(s: FieldScenes, t: date) -> dict | None:
    """Scena docelowa dla dnia prognozy t albo None, gdy w t+7 … t+14 nie ma zaakceptowanej sceny."""
    t64 = np.datetime64(t, "D")
    lo, hi = TARGET_WINDOW_DAYS
    acc = s.accepted
    sel = acc[(s.dates[acc] >= t64 + np.timedelta64(lo, "D")) & (s.dates[acc] <= t64 + np.timedelta64(hi, "D"))]
    if sel.size == 0:
        return None
    k = int(sel[0])
    return {"ndmi_future": float(s.ndmi[k]), "target_index": k, "target_valid_fraction": float(s.valid_fraction[k])}


def issue_dates(season: int) -> list[date]:
    """Dni prognozy sezonu: co ISSUE_STEP_DAYS od ISSUE_FIRST do ISSUE_LAST włącznie."""
    d = date.fromisoformat(f"{season}-{C.ISSUE_FIRST}")
    end = date.fromisoformat(f"{season}-{C.ISSUE_LAST}")
    out = []
    while d <= end:
        out.append(d)
        d += timedelta(days=C.ISSUE_STEP_DAYS)
    return out
