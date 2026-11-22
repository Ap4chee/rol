"""Funkcja pedotransferowa Saxtona i Rawlsa (2006) oraz klasy uziarnienia USDA. Bez sieci."""
import pytest

from app.core.ptf import organic_matter_pct_from_soc, saxton_rawls_2006, usda_texture_class


def test_loam_matches_published_table():
    # Saxton i Rawls (2006), tab. 3: glina (loam) 40% piasku, 20% iłu, 2,5% materii organicznej
    # -> punkt więdnięcia ok. 14%, pojemność polowa ok. 28% objętości
    soil = saxton_rawls_2006(0.40, 0.20, 2.5)
    assert soil.field_capacity * 100 == pytest.approx(28.0, abs=1.0)
    assert soil.wilting_point * 100 == pytest.approx(14.0, abs=1.0)
    assert not soil.clipped


# Saxton i Rawls (2006), tab. 3: wartości dla klas uziarnienia przy 2,5% materii organicznej,
# bez poprawek na zasolenie, żwir i gęstość. Tabela sprawdzona w kopii publikacji 21.11.2026
# (doi:10.2136/sssaj2005.0117). Kolumny: piasek %, ił %, punkt więdnięcia % obj., pojemność polowa % obj.
TABLE_3 = [
    ("sand", 88, 5, 5, 10),
    ("loamy sand", 80, 5, 5, 12),
    ("sandy loam", 65, 10, 8, 18),
    ("loam", 40, 20, 14, 28),
    ("silt loam", 20, 15, 11, 31),
    ("silt", 10, 5, 6, 30),
    ("sandy clay loam", 60, 25, 17, 27),
    ("clay loam", 30, 35, 22, 36),
    ("silty clay loam", 10, 35, 22, 38),
    ("silty clay", 10, 45, 27, 41),
    ("sandy clay", 50, 40, 25, 36),
    ("clay", 25, 50, 30, 42),
]


@pytest.mark.parametrize("name, sand, clay, wilting, capacity", TABLE_3)
def test_all_rows_of_published_table(name, sand, clay, wilting, capacity):
    soil = saxton_rawls_2006(sand / 100.0, clay / 100.0, 2.5)
    assert soil.wilting_point * 100 == pytest.approx(wilting, abs=0.6), name   # tabela podaje liczby całkowite
    assert soil.field_capacity * 100 == pytest.approx(capacity, abs=0.6), name


def test_sand_holds_less_water_than_loam():
    sand = saxton_rawls_2006(0.88, 0.05, 2.5)
    loam = saxton_rawls_2006(0.40, 0.20, 2.5)
    assert sand.available < loam.available
    assert sand.field_capacity < loam.field_capacity


def test_inputs_outside_range_are_clipped_and_flagged():
    soil = saxton_rawls_2006(0.10, 0.75, 12.0)
    assert soil.clipped
    assert 0.0 < soil.wilting_point <= soil.field_capacity < 0.7


def test_organic_matter_from_carbon():
    assert organic_matter_pct_from_soc(14.5) == pytest.approx(2.5, abs=0.01)


@pytest.mark.parametrize("sand, silt, clay, expected", [
    (90, 5, 5, "sand"),
    (82, 12, 6, "loamy sand"),
    (65, 25, 10, "sandy loam"),
    (40, 40, 20, "loam"),
    (33.7, 48.2, 18.1, "loam"),       # działka 580/2, warstwa 0–5 cm (wzorzec z tests/fixtures/)
    (20, 65, 15, "silt loam"),
    (8, 87, 5, "silt"),
    (60, 13, 27, "sandy clay loam"),
    (32, 34, 34, "clay loam"),
    (10, 56, 34, "silty clay loam"),
    (52, 6, 42, "sandy clay"),
    (6, 47, 47, "silty clay"),
    (20, 20, 60, "clay"),
])
def test_usda_texture_classes(sand, silt, clay, expected):
    assert usda_texture_class(sand, silt, clay) == expected
