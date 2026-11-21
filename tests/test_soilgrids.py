"""SoilGrids: komórki siatki pod działką, średnia ważona powierzchnią, warianty gleby. Bez sieci.

Wzorzec: outputs/soilgrids_niedrzwica_koscielna_580_2.json (dwie komórki 250 m, wagi ok. 16% i 84%,
warstwa 0–5 cm: piasek 33,7%, pył 48,2%, ił 18,1%).
"""
import json
from pathlib import Path

import numpy as np
import pytest
from shapely.geometry import Point, shape

from app.core.soil import build_variants
from app.sources.soilgrids import (
    DEPTHS,
    NODATA,
    cell_grid,
    depth_label,
    layers_from_values,
    parse_rest,
    tile_for_cell,
    weighted_mean,
)
from app.sources import NoData

REFERENCE = json.loads((Path(__file__).resolve().parent.parent / "outputs"
                        / "soilgrids_niedrzwica_koscielna_580_2.json").read_text(encoding="utf-8"))
PARCEL = shape(REFERENCE["parcel"]["geometry_wgs84"])


def test_cells_and_weights_match_reference():
    grid = cell_grid(PARCEL)
    assert grid.cells == 2
    ours = {(grid.row0 + r, grid.col0 + c): float(grid.weights[r, c])
            for r in range(grid.nrows) for c in range(grid.ncols) if grid.weights[r, c] > 0}
    for cell in REFERENCE["soilgrids"]["cells"]:
        assert ours[(cell["row"], cell["col"])] == pytest.approx(cell["weight"], abs=0.002)
    assert sum(ours.values()) == pytest.approx(1.0)


def test_point_gives_single_cell():
    grid = cell_grid(Point(22.355914, 51.093307))
    assert (grid.nrows, grid.ncols) == (1, 1)
    assert float(grid.weights[0, 0]) == 1.0


def test_weighted_mean_ignores_cells_without_data():
    values = np.array([[100.0, np.nan], [300.0, 500.0]])
    weights = np.array([[0.25, 0.25], [0.5, 0.0]])
    assert weighted_mean(values, weights) == pytest.approx((100 * 0.25 + 300 * 0.5) / 0.75)
    assert weighted_mean(np.full((2, 2), np.nan), weights) is None


def _values(sand: float, clay: float, grid) -> dict[str, np.ndarray]:
    out = {}
    for top, bottom in DEPTHS:
        depth = depth_label(top, bottom)
        out[f"sand_{depth}_mean"] = np.full(grid.weights.shape, sand)
        out[f"clay_{depth}_mean"] = np.full(grid.weights.shape, clay)
        out[f"sand_{depth}_Q0.05"] = np.full(grid.weights.shape, sand * 0.2)
        out[f"sand_{depth}_Q0.95"] = np.full(grid.weights.shape, min(sand * 2.2, 950.0))
        out[f"clay_{depth}_Q0.05"] = np.full(grid.weights.shape, clay * 0.1)
        out[f"clay_{depth}_Q0.95"] = np.full(grid.weights.shape, min(clay * 3.5, 900.0))
        out[f"soc_{depth}_mean"] = np.full(grid.weights.shape, 145.0)   # dg/kg -> 14,5 g/kg
        out[f"bdod_{depth}_mean"] = np.full(grid.weights.shape, 140.0)  # cg/cm3 -> 1,40 g/cm3
    return out


def test_layers_convert_units_and_weight_cells():
    grid = cell_grid(PARCEL)
    values = _values(336.0, 178.0, grid)
    # komórka o wadze ok. 16% ma inną zawartość piasku w warstwie 0–5 cm
    r, c = np.unravel_index(np.argmin(np.where(grid.weights > 0, grid.weights, 9)), grid.weights.shape)
    values["sand_0-5cm_mean"][r, c] = 400.0
    layers = layers_from_values(values, grid)
    assert len(layers) == 6
    expected = (336.0 * (1 - grid.weights[r, c]) + 400.0 * grid.weights[r, c]) / 10.0
    assert layers[0].sand_pct == pytest.approx(expected)
    assert layers[0].clay_pct == pytest.approx(17.8)
    assert layers[0].silt_pct == pytest.approx(100.0 - expected - 17.8)   # pył z dopełnienia, gdy brak warstwy
    assert layers[0].soc_g_kg == pytest.approx(14.5)
    assert layers[0].bulk_density_g_cm3 == pytest.approx(1.40)
    assert layers[3].top_cm == 30 and layers[3].bottom_cm == 60


def test_missing_texture_is_reported_as_no_data():
    grid = cell_grid(PARCEL)
    values = _values(336.0, 178.0, grid)
    values["sand_0-5cm_mean"][:] = np.nan
    with pytest.raises(NoData):
        layers_from_values(values, grid)


def test_variants_bracket_the_mean_and_use_quantiles():
    grid = cell_grid(PARCEL)
    layers = layers_from_values(_values(336.0, 178.0, grid), grid)
    variants = {v.key: v for v in build_variants(layers, root_depth_m=1.0)}
    assert set(variants) == {"mean", "light", "heavy"}
    awc = {k: v.fc_root - v.wp_root for k, v in variants.items()}
    assert awc["light"] < awc["mean"]            # gleba piaszczysta trzyma mniej wody dostępnej
    assert variants["heavy"].wp_root > variants["mean"].wp_root > variants["light"].wp_root
    # bez kwantyli powstaje tylko wariant średni
    for layer in layers:
        layer.sand_q05_pct = None
    assert [v.key for v in build_variants(layers, 1.0)] == ["mean"]


def test_parse_rest_response():
    payload = {"properties": {"layers": [
        {"name": "clay", "depths": [{"label": "0-5cm", "values": {"Q0.05": 5, "Q0.95": 707, "mean": 178}}]},
        {"name": "sand", "depths": [{"label": "0-5cm", "values": {"mean": None}}]},
    ]}}
    parsed = parse_rest(payload)
    assert parsed == {"clay_0-5cm_Q0.05": 5.0, "clay_0-5cm_Q0.95": 707.0, "clay_0-5cm_mean": 178.0}


def test_local_tile_index_locates_reference_cell():
    cell = REFERENCE["soilgrids"]["cells"][0]
    located = tile_for_cell(cell["col"], cell["row"])
    assert located is not None
    path, col_in_tile, row_in_tile = located
    assert path.endswith(".tif") and 0 <= col_in_tile < 450 and 0 <= row_in_tile < 450
    assert tile_for_cell(0, 0) is None            # poza Polską
    assert NODATA == -32768
