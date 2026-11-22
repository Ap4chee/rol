"""Jedno miejsce, w którym powstaje klient HTTP do zewnętrznych usług (nagłówek aplikacji, przekierowania)."""
from __future__ import annotations

import httpx

from app.config import USER_AGENT


def new_client(follow_redirects: bool = True) -> httpx.AsyncClient:
    """Klient z nagłówkiem aplikacji. Limity czasu ustawia każdy adapter przy swoim zapytaniu."""
    return httpx.AsyncClient(headers={"User-Agent": USER_AGENT}, follow_redirects=follow_redirects)
