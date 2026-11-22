import assert from 'node:assert/strict';
import { test } from 'node:test';
import { balanceText, layersWord, mergeSoilLayers, shareAbove, soilProfile } from './logic.js';

const layer = (top, bottom, key) => ({ top_cm: top, bottom_cm: bottom, texture_key: key, available_water_mm: 10,
  sand_pct: 30, silt_pct: 40, clay_pct: 30, field_capacity_vol_pct: 30, wilting_point_vol_pct: 15, soc_g_kg: null });
const report = (layers, rootDepthM, rootNowM) => ({
  soil: { layers, root_depth_m: rootDepthM }, crop: { root_depth_m: rootDepthM, root_depth_now_m: rootNowM } });

test('scalona warstwa przecięta granicą strefy jest „częściowo”, a nie w całości w zasięgu', () => {
  // 60–100 i 100–200 cm tej samej gleby scalają się w 60–200; strefa bilansu do 100 cm przecina ją w 2/7
  const profile = soilProfile(report([layer(0, 30, 'loam'), layer(30, 60, 'sand'), layer(60, 100, 'clay'), layer(100, 200, 'clay')], 1.0, 1.0));
  assert.deepEqual(profile.layers.map((l) => [l.top_cm, l.bottom_cm, l.balance]),
    [[0, 30, 'full'], [30, 60, 'full'], [60, 200, 'partial']]);
  assert.equal(profile.layers[2].balanceShare, 40 / 140);
  assert.equal(balanceText(profile.layers[2], profile.balanceCm), 'w strefie bilansu do 100 cm');
  assert.equal(profile.belowBalance, false);
});

test('warstwa zaczynająca się na granicy strefy jest poza nią', () => {
  const profile = soilProfile(report([layer(0, 60, 'loam'), layer(60, 100, 'sand')], 0.6, 0.6));
  assert.deepEqual(profile.layers.map((l) => l.balance), ['full', 'none']);
  assert.equal(profile.belowBalance, true);
});

test('głębokość bilansu i korzeni w dniu analizy mają osobne znaczenie', () => {
  const profile = soilProfile(report([layer(0, 30, 'loam'), layer(30, 60, 'sand'), layer(60, 100, 'clay')], 1.0, 0.25));
  assert.equal(profile.balanceCm, 100);
  assert.equal(profile.rootsNowCm, 25);
  assert.deepEqual(profile.layers.map((l) => [l.balance, l.roots]), [['full', 'partial'], ['full', 'none'], ['full', 'none']]);
});

test('brak korzeni (uprawy nie ma na polu) i brak gleby nie udają danych', () => {
  const bare = soilProfile(report([layer(0, 30, 'loam')], 1.0, null));
  assert.equal(bare.rootsNowCm, null);
  assert.equal(bare.layers[0].roots, 'none');
  const none = soilProfile({ soil: { status: 'no_data', layers: [] }, crop: { root_depth_m: 1.2 } });
  assert.equal(none.missing, true);
  assert.equal(none.layers.length, 0);
  assert.equal(none.balanceCm, 120);
});

test('udział warstwy nad głębokością', () => {
  const l = layer(30, 60, 'loam');
  assert.deepEqual([0, 30, 45, 60, 90].map((d) => shareAbove(l, d)), [0, 0, 0.5, 1, 1]);
});

test('sąsiednie warstwy tej samej gleby łączą się w jedną', () => {
  const layer = (top, bottom, key, water, sand) => ({ top_cm: top, bottom_cm: bottom, texture_key: key, available_water_mm: water,
    sand_pct: sand, silt_pct: 40, clay_pct: 60 - sand, field_capacity_vol_pct: 30, wilting_point_vol_pct: 15, soc_g_kg: null });
  const merged = mergeSoilLayers([layer(0, 5, 'loam', 10, 30), layer(5, 15, 'loam', 16, 36), layer(15, 30, 'silt_loam', 24, 20),
    layer(30, 60, 'loam', 40, 40)]);
  assert.deepEqual(merged.map((l) => [l.top_cm, l.bottom_cm, l.texture_key, l.available_water_mm]),
    [[0, 15, 'loam', 26], [15, 30, 'silt_loam', 24], [30, 60, 'loam', 40]]);
  assert.equal(merged[0].sand_pct, 34);          // (30·5 + 36·10) / 15
  assert.equal(merged[0].soc_g_kg, null);        // brak danych zostaje brakiem
  assert.deepEqual([1, 3, 5, 12, 22].map(layersWord), ['warstwa', 'warstwy', 'warstw', 'warstw', 'warstwy']);
});
