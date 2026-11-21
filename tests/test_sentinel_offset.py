"""Przesunięcie reflektancji scen Sentinel-2 z metadanych STAC. Bez sieci.

W kolekcji `sentinel-2-l2a` sceny z bazą przetwarzania od 04.00 mają przesunięcie 1000 DN już odjęte w pikselach,
a `raster:bands` nadal podaje offset −0,1. Flaga `earthsearch:boa_offset_applied` bywa przy tym błędna (`false`
przy pikselach po korekcie), więc dla tej kolekcji offset zawsze wynosi 0. Wartości z testu pochodzą z tej samej
sceny w obu kolekcjach (3.06.2023, kafel 34UEB, mediana z okna ok. 4 × 4 km koło Niedrzwicy Kościelnej):
B8A 5362 DN w `sentinel-2-c1-l2a` i 4362 DN w `sentinel-2-l2a`, B11 2827 i 1827 DN, B04 1651 i 651 DN,
oraz z dwóch kafli tego samego przelotu z 10.05.2022 koło Inowrocławia (B11 1911 DN z flagą `false`, 1908 DN
z flagą `true`). Sprawdzenie na żywo: `scripts/check_sentinel_offset.py`.
"""
from types import SimpleNamespace

import pytest

from app.sources.sentinel import _scene_from_item

BANDS = ("nir08", "swir16", "red")


def item(offset, applied=None, with_scale=True):
    band = {"nodata": 0, "offset": offset}
    if with_scale:
        band["scale"] = 0.0001
    assets = {key: SimpleNamespace(href=f"https://example.test/{key}.tif", extra_fields={"raster:bands": [dict(band)]})
              for key in BANDS}
    assets["scl"] = SimpleNamespace(href="https://example.test/scl.tif", extra_fields={"raster:bands": [{"nodata": 0}]})
    properties = {"datetime": "2023-06-03T09:50:31Z", "platform": "sentinel-2a"}
    if applied is not None:
        properties["earthsearch:boa_offset_applied"] = applied
    return SimpleNamespace(id="S2A_34UEB_20230603_0_L2A", assets=assets, properties=properties)


def reflectance(scene, key, dn):
    return dn * scene.scale[key] + scene.offset[key]


def test_c1_collection_uses_offset_from_metadata():
    scene = _scene_from_item(item(-0.1), "sentinel-2-c1-l2a")
    assert all(scene.offset[key] == -0.1 for key in BANDS)
    assert reflectance(scene, "nir08", 5362) == pytest.approx(0.4362)


def test_offset_already_applied_in_pixels_is_not_subtracted_again():
    scene = _scene_from_item(item(-0.1, applied=True), "sentinel-2-l2a")
    assert all(scene.offset[key] == 0.0 for key in BANDS)
    # ta sama scena daje tę samą reflektancję co w kolekcji c1, a czerwień nie wychodzi ujemna
    assert reflectance(scene, "nir08", 4362) == pytest.approx(0.4362)
    assert reflectance(scene, "swir16", 1827) == pytest.approx(0.1827)
    assert reflectance(scene, "red", 651) == pytest.approx(0.0651)


def test_older_collection_ignores_a_wrong_flag():
    """Flaga `false` przy pikselach po korekcie (wpisy katalogu z 3.11.2022): offset i tak 0."""
    flagged_false = _scene_from_item(item(-0.1, applied=False), "sentinel-2-l2a")
    flagged_true = _scene_from_item(item(-0.1, applied=True), "sentinel-2-l2a")
    assert all(flagged_false.offset[key] == 0.0 for key in BANDS)
    assert reflectance(flagged_false, "swir16", 1911) == pytest.approx(0.1911)
    assert reflectance(flagged_true, "swir16", 1908) == pytest.approx(0.1908)


def test_flag_is_respected_in_any_collection():
    scene = _scene_from_item(item(-0.1, applied=True), "sentinel-2-c1-l2a")
    assert all(scene.offset[key] == 0.0 for key in BANDS)


def test_old_baseline_without_offset_is_unchanged():
    scene = _scene_from_item(item(0, applied=False), "sentinel-2-l2a")
    assert all(scene.offset[key] == 0.0 for key in BANDS)
    assert reflectance(scene, "nir08", 4053) == pytest.approx(0.4053)


def test_scene_without_scale_is_skipped():
    assert _scene_from_item(item(-0.1, with_scale=False), "sentinel-2-l2a") is None
