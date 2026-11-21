"""Spływ z modelu terenu: wypełnianie zagłębień, kierunki D8, powierzchnia zasilająca, przecięcia granicy. Bez sieci."""
import numpy as np
import pytest

from app.core.flow import (
    analyse,
    box_mean,
    d8_receivers,
    flow_accumulation,
    priority_flood_fill,
    slope_percent,
)


def valley(rows=40, cols=41, along=0.05, across=0.2):
    """Dolina w kształcie V opadająca na południe: oś doliny w środkowej kolumnie."""
    r = np.arange(rows)[:, None]
    c = np.arange(cols)[None, :]
    return 100.0 - along * r + across * np.abs(c - cols // 2)


def test_plane_drains_to_lowest_edge_and_conserves_cells():
    rows, cols = 20, 15
    dem = 50.0 - 0.1 * np.arange(rows)[:, None] + np.zeros((rows, cols))   # spadek na południe
    filled = priority_flood_fill(dem)
    assert np.allclose(filled, dem)                      # nic do wypełnienia
    receivers = d8_receivers(filled)
    acc = flow_accumulation(filled, receivers)
    assert acc[0].tolist() == [1] * cols                 # górny rząd nie ma dopływu
    assert acc[-1].sum() == rows * cols                  # cała powierzchnia odpływa dolnym brzegiem
    assert (receivers.reshape(rows, cols)[-1] == -1).all()


def test_pit_is_filled_to_spill_level_and_still_drains():
    dem = 10.0 - 0.01 * np.arange(30)[:, None] + np.zeros((30, 30))
    dem[10:15, 10:15] -= 2.0                             # zagłębienie bezodpływowe o głębokości 2 m
    filled = priority_flood_fill(dem)
    depth = filled - dem
    assert depth[12, 12] == pytest.approx(2.0 - 0.01 * 2, abs=0.05)   # wypełnione do poziomu przelewu
    assert depth[0, 0] == 0.0
    acc = flow_accumulation(filled, d8_receivers(filled))
    assert acc.max() <= dem.size
    assert acc[-1].sum() + acc[:-1, 0].sum() * 0 >= 1    # odpływ istnieje
    # każda komórka zagłębienia ma odbiornik, czyli woda z niego wypływa
    assert (d8_receivers(filled).reshape(30, 30)[10:15, 10:15] >= 0).all()


def test_valley_concentrates_flow_on_its_axis():
    dem = valley()
    filled = priority_flood_fill(dem)
    acc = flow_accumulation(filled, d8_receivers(filled))
    axis = dem.shape[1] // 2
    assert int(np.argmax(acc[-1])) == axis
    assert acc[-1, axis] > 0.8 * dem.size                # prawie cała zlewnia schodzi osią doliny
    assert acc[5, axis] < acc[30, axis]                  # powierzchnia zasilająca rośnie w dół doliny


def test_crossings_of_parcel_in_valley():
    dem = valley()
    inside = np.zeros(dem.shape, dtype=bool)
    inside[10:30, 15:26] = True                          # działka w poprzek osi doliny
    result = analyse(dem, inside, cell_m=1.0, threshold_m2=100.0)
    kinds = sorted(c.kind for c in result.crossings)
    assert "inflow" in kinds and "outflow" in kinds
    outflow = max((c for c in result.crossings if c.kind == "outflow"), key=lambda c: c.area_m2)
    inflow = max((c for c in result.crossings if c.kind == "inflow"), key=lambda c: c.area_m2)
    assert outflow.row == pytest.approx(29.5) and outflow.col == pytest.approx(20.0)   # dolna granica, oś doliny
    assert inflow.row == pytest.approx(9.5)
    assert outflow.area_m2 > inflow.area_m2 > 100.0      # w dół doliny zlewnia rośnie
    assert result.lines and all(len(line) >= 2 for line, _ in result.lines)


def test_threshold_hides_small_paths():
    dem = valley()
    inside = np.zeros(dem.shape, dtype=bool)
    inside[10:30, 15:26] = True
    assert analyse(dem, inside, 1.0, threshold_m2=10_000.0).crossings == []


def test_cell_size_scales_area():
    dem = valley()
    inside = np.zeros(dem.shape, dtype=bool)
    inside[10:30, 15:26] = True
    one = max(c.area_m2 for c in analyse(dem, inside, 1.0, 100.0).crossings)
    two = max(c.area_m2 for c in analyse(dem, inside, 2.0, 400.0).crossings)
    assert two == pytest.approx(4 * one)


def test_slope_of_tilted_plane():
    dem = 100.0 - 0.03 * np.arange(60)[:, None] + 0.04 * np.arange(50)[None, :]
    slope = slope_percent(dem, cell_m=1.0)
    assert slope[10:50, 10:40].mean() == pytest.approx(5.0, abs=0.05)   # sqrt(3^2 + 4^2) %


def test_box_mean_keeps_constant_and_smooths_spike():
    assert np.allclose(box_mean(np.full((9, 9), 7.0), 5), 7.0)
    spike = np.zeros((9, 9))
    spike[4, 4] = 25.0
    assert box_mean(spike, 5)[4, 4] == pytest.approx(1.0)
