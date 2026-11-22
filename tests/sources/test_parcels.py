"""Polityka wyszukiwania działki (app.sources.parcels) bez sieci: adaptery ULDK, WFS EGiB i PRG podstawione."""
import asyncio

import pytest
from shapely.geometry import box

from app.sources import NoData, SourceError, parcels

GEOM = box(22.37, 51.11, 22.38, 51.12)  # EPSG:4326, lon, lat


def _record(parcel_id: str) -> dict:
    return {"id": parcel_id, "number": parcel_id.rsplit(".", 1)[-1], "region": "Niedrzwica Kościelna",
            "commune": "Niedrzwica Duża", "county": None, "voivodeship": "lubelskie", "geometry": GEOM}


class Fake:
    """Podstawione adaptery z licznikami wywołań."""

    def __init__(self, monkeypatch, uldk=None, wfs=None, districts=None):
        self.calls = {"uldk": 0, "wfs": 0, "prg": 0}
        self.uldk, self.wfs, self.districts = uldk, wfs, districts or []
        store: dict = {}
        monkeypatch.setattr(parcels.cache, "get", lambda ns, key, max_age_s=None: store.get((ns, key)))
        monkeypatch.setattr(parcels.cache, "put", lambda ns, key, value: store.__setitem__((ns, key), value))
        monkeypatch.setattr(parcels.uldk, "fetch_parcel_by_id", self._uldk)
        monkeypatch.setattr(parcels.uldk, "fetch_parcel_by_point", lambda c, lon, lat: self._uldk(c, "point"))
        monkeypatch.setattr(parcels.uldk, "search", self._uldk_search)
        monkeypatch.setattr(parcels.egib_wfs, "fetch_parcel_by_id", self._wfs)
        monkeypatch.setattr(parcels.egib_wfs, "fetch_parcel_by_point", lambda c, lon, lat: self._wfs(c, "point"))
        monkeypatch.setattr(parcels.egib_wfs, "find_districts", self._prg)

    async def _uldk(self, client, parcel_id):
        self.calls["uldk"] += 1
        return self.uldk(parcel_id)

    async def _uldk_search(self, client, query):
        self.calls["uldk"] += 1
        return self.uldk(query)

    async def _wfs(self, client, parcel_id):
        self.calls["wfs"] += 1
        return self.wfs(parcel_id)

    async def _prg(self, client, name):
        self.calls["prg"] += 1
        return self.districts


def _fail(_):
    raise SourceError("ULDK nie odpowiedziało poprawnie: HTTP 503")


def _corrupt(_):
    # Tak zachowuje się uldk.parse_parcel przy uszkodzonej geometrii.
    raise SourceError("ULDK zwróciło nieczytelną geometrię działki")


def run(coro):
    return asyncio.run(coro)


def test_uldk_ok_gives_uldk_source_and_caches(monkeypatch):
    fake = Fake(monkeypatch, uldk=_record, wfs=_record)
    parcel, from_cache = run(parcels.get_parcel_by_id(None, "060910_2.0011.580/2"))
    assert (parcel.source, from_cache, fake.calls["wfs"]) == ("uldk", False, 0)
    again, from_cache = run(parcels.get_parcel_by_id(None, "060910_2.0011.580/2"))
    assert from_cache and again.source == "uldk" and fake.calls["uldk"] == 1


def test_corrupt_uldk_geometry_falls_back_to_wfs(monkeypatch):
    fake = Fake(monkeypatch, uldk=_corrupt, wfs=_record)
    parcel, _ = run(parcels.get_parcel_by_id(None, "060910_2.0011.580/2"))
    assert parcel.source == "egib_wfs" and fake.calls == {"uldk": 1, "wfs": 1, "prg": 0}
    assert parcel.area_ha > 0


def test_uldk_no_match_does_not_use_fallback(monkeypatch):
    def unknown(pid):
        raise NoData(f"ULDK nie zna działki o identyfikatorze {pid}.")
    fake = Fake(monkeypatch, uldk=unknown, wfs=_record)
    with pytest.raises(NoData):
        run(parcels.get_parcel_by_id(None, "060910_2.0011.999/9"))
    assert fake.calls["wfs"] == 0


def test_point_fallback_caches_cached_source(monkeypatch):
    fake = Fake(monkeypatch, uldk=_fail, wfs=lambda _: _record("060910_2.0011.580/2"))
    parcel, _ = run(parcels.get_parcel_by_point(None, 22.375, 51.115))
    assert parcel.source == "egib_wfs"
    by_id, from_cache = run(parcels.get_parcel_by_id(None, parcel.id))
    assert from_cache and by_id.source == "egib_wfs" and fake.calls["uldk"] == 1


def test_both_sources_fail_names_both(monkeypatch):
    def wfs_down(_):
        raise SourceError("WFS EGiB: HTTP 500")
    Fake(monkeypatch, uldk=_fail, wfs=wfs_down)
    with pytest.raises(SourceError, match="ULDK.*WFS"):
        run(parcels.get_parcel_by_id(None, "060910_2.0011.580/2"))


def test_search_after_uldk_failure_does_not_retry_uldk_per_candidate(monkeypatch):
    districts = [(f"0609{i:02d}_2.0011", "NIEDRZWICA KOŚCIELNA") for i in range(5)]

    def wfs(pid):
        if pid.startswith("060900"):
            raise NoData("brak")
        return _record(pid)
    fake = Fake(monkeypatch, uldk=_fail, wfs=wfs, districts=districts)
    candidates, truncated = run(parcels.search_parcels(None, "Niedrzwica Kościelna 580/2"))
    assert fake.calls == {"uldk": 1, "wfs": 5, "prg": 1}
    assert len(candidates) == 4 and not truncated


def test_search_after_uldk_failure_with_full_id_goes_straight_to_wfs(monkeypatch):
    fake = Fake(monkeypatch, uldk=_fail, wfs=_record)
    candidates, _ = run(parcels.search_parcels(None, "060910_2.0011.580/2"))
    assert candidates[0]["id"] == "060910_2.0011.580/2"
    assert fake.calls == {"uldk": 1, "wfs": 1, "prg": 0}


def test_search_all_candidates_fail_reports_source_error(monkeypatch):
    def wfs_down(_):
        raise SourceError("WFS EGiB: HTTP 500")
    Fake(monkeypatch, uldk=_fail, wfs=wfs_down, districts=[("060910_2.0011", "X"), ("060911_2.0011", "X")])
    with pytest.raises(SourceError):
        run(parcels.search_parcels(None, "X 580/2"))


def test_search_unknown_district_is_no_data(monkeypatch):
    Fake(monkeypatch, uldk=_fail, wfs=_record, districts=[])
    with pytest.raises(NoData, match="obrębu"):
        run(parcels.search_parcels(None, "Nieistniejąca 1/2"))
