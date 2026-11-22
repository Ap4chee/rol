import assert from 'node:assert/strict';
import { test } from 'node:test';
import { actionItems, daysBetween, fieldFromReport, fieldHref, firstAction, FULL_ID, inputFromReport, oldestDate, readFields, removeField, replaceField, route, sameReportInputs, satelliteMeasurements, seasonMonths, stressSeasons, today, upsertField, waterPercent } from './model.js';

test('identyfikatory i zapis pola zachowują działki o nietypowych numerach', () => {
  const id = '022602_1.0003.AR_4.59/2';
  assert.equal(FULL_ID.test(id), true);
  assert.equal(route(fieldHref(id)), id);
  assert.equal(route('#pole/%'), null);
  const report = { request: { parcel_id: id }, parcel: { id, number: '59/2' }, crop: {},
    water_status: {}, causes: {}, history: {}, recommendations: {}, terrain: {}, satellite: {}, soil: {}, hydrology: {} };
  const field = fieldFromReport(report);
  assert.equal(field.name, 'Działka 59/2');
  assert.deepEqual(readFields({ getItem: () => JSON.stringify([null, field]) }), [field]);
  assert.deepEqual(upsertField([field], { ...field, name: 'Pod lasem' }).map((item) => item.name), ['Pod lasem']);
  assert.deepEqual(readFields({ getItem: () => ']' }), []);
});

test('puste dane i zero nie mają tego samego znaczenia', () => {
  assert.equal(waterPercent({ available_mm: 0, taw_mm: 78 }), 0);
  assert.equal(waterPercent({ available_mm: 15, taw_mm: 0 }), null);
  assert.equal(waterPercent({ available_mm: 22, taw_mm: 100 }), 22);
  assert.deepEqual(satelliteMeasurements({ observations: [
    { accepted: true, date: '2025-09-10', ndvi: 0 },
    { accepted: false, date: '2025-09-01', ndvi: .81 },
    { accepted: true, date: '2025-08-10', ndvi: -.05 },
  ] }).map((s) => s.ndvi), [-.05, 0]);
});

test('kalendarz rozpoznaje lata przestępne i okres uprawy przez granicę roku', () => {
  assert.equal(oldestDate('2024-02-29'), '2014-02-28');
  assert.deepEqual(seasonMonths({ critical_from: '2025-11-12', critical_to: '2026-02-01' }), [10, 11, 0, 1]);
});

test('zadania biorą zalecenia z raportów i wskazują najpierw silny niedobór, z pierwszeństwem retencji', () => {
  const field = (id, key, recommendations) => ({ id, report: { water_status: { class_key: key }, recommendations } });
  const entries = [field('a', 'moderate', { retention: [{ title: 'Zatrzymaj wodę' }] }),
    field('b', 'severe', { retention: [{ title: 'Okrywa gleby' }], irrigation: [{ title: 'Podlej' }] }),
    field('c', 'severe', { irrigation: [{ title: 'Podlej' }] }), field('d', 'none', {})];
  assert.deepEqual(actionItems(entries).map((item) => item.action.title), ['Okrywa gleby', 'Podlej', 'Zatrzymaj wodę']);
});

test('sąsiednie warstwy tej samej gleby łączą się w jedną', async () => {
  const { mergeSoilLayers, layersWord } = await import('./model.js');
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

test('adres pola niesie zakładkę, a identyfikator z ukośnikiem przechodzi bez zmian', async () => {
  const { fieldTabHref, routeTab } = await import('./model.js');
  const id = '060910_2.0011.580/2';
  assert.deepEqual(routeTab(fieldHref(id)), { id, tab: 'podsumowanie' });
  assert.deepEqual(routeTab(fieldTabHref(id, 'gleba')), { id, tab: 'gleba' });
  assert.deepEqual(routeTab(fieldTabHref(id, 'nieznana')), { id, tab: 'podsumowanie' });
  assert.deepEqual(routeTab('#podglad/pogoda'), { id: 'preview', tab: 'pogoda' });
  assert.equal(route('#dodaj'), null);
});

test('edycja i usuwanie pól zachowują porządek bez duplikatów i wykrywają samą zmianę nazwy', () => {
  const mk = (id, name, extra = {}) => ({
    id, name,
    report: {
      analysis_date: '2026-07-01', crop: { key: 'maize' },
      parcel: { id, number: id }, request: { parcel_id: id }, ...extra,
    },
  });
  const a = mk('a', 'Pole A'), b = mk('b', 'Pole B'), c = mk('c', 'Pole C');
  // zmiana działki zastępuje edytowane pole na miejscu
  assert.deepEqual(replaceField([a, b, c], 'b', mk('d', 'Pole D')).map((f) => f.id), ['a', 'd', 'c']);
  // zmiana działki na już zapisaną nie tworzy duplikatu
  assert.deepEqual(replaceField([a, b, c], 'b', mk('a', 'Pole A nowe')).map((f) => [f.id, f.name]),
    [['a', 'Pole A nowe'], ['c', 'Pole C']]);
  // usuwanie zostawia pozostałe pola
  assert.deepEqual(removeField([a, b, c], 'b').map((f) => f.id), ['a', 'c']);
  // sama zmiana nazwy vs zmiana danych wejściowych (porównanie z danymi pola zapisanymi na serwerze)
  const saved = { id: 'a', name: 'Pole A', input: { parcel_id: 'a', point: null, crop: 'maize', date: '2026-07-01', test: false } };
  assert.equal(sameReportInputs(saved, { parcel: { id: 'a' }, point: null, crop: 'maize', date: '2026-07-01' }), true);
  assert.equal(sameReportInputs(saved, { parcel: { id: 'a' }, point: null, crop: 'potato', date: '2026-07-01' }), false);
  assert.equal(sameReportInputs(saved, { parcel: { id: 'a' }, point: null, crop: 'maize', date: '2026-06-30' }), false);
  assert.equal(sameReportInputs(saved, { parcel: { id: 'a' }, crop: 'maize', date: '2026-07-01', sowing_date: '2026-05-01' }), false);
  assert.equal(sameReportInputs(saved, { parcel: { id: 'b' }, point: null, crop: 'maize', date: '2026-07-01' }), false);
  assert.equal(sameReportInputs(saved, { parcel: null, point: { lat: 52, lon: 19 }, crop: 'maize', date: '2026-07-01', test: true }), false);
  // pole na dziś (date: null) zostaje na dziś, gdy formularz ma dzisiejszą datę
  assert.equal(sameReportInputs({ input: { ...saved.input, date: null } }, { parcel: { id: 'a' }, crop: 'maize', date: today() }), true);
  // pole oparte na punkcie bez działki
  const pt = { input: { parcel_id: null, point: { lat: 52, lon: 19 }, crop: 'maize', date: '2026-07-01', test: false } };
  assert.equal(sameReportInputs(pt, { parcel: null, point: { lat: 52, lon: 19 }, crop: 'maize', date: '2026-07-01' }), true);
  assert.equal(sameReportInputs(pt, { parcel: null, point: { lat: 52, lon: 19.1 }, crop: 'maize', date: '2026-07-01' }), false);
});

test('dane pola z raportu: działka, punkt, obrys testowy i pole na dziś', () => {
  const base = { crop: { key: 'maize' }, analysis_date: '2026-07-01', generated_at: '2026-07-03T10:00:00Z' };
  assert.deepEqual(inputFromReport({ ...base, request: { parcel_id: 'x' }, parcel: { id: 'x' } }, ' Pod lasem '),
    { name: 'Pod lasem', crop: 'maize', date: '2026-07-01', test: false, parcel_id: 'x' });
  assert.equal(inputFromReport({ ...base, request: { parcel_id: 'x', harvest_date: '2026-09-21' } }).harvest_date, '2026-09-21');
  assert.deepEqual(inputFromReport({ ...base, request: { point: { lat: 52, lon: 19 } }, parcel: { id: 'TEST' } }).point, { lat: 52, lon: 19 });
  assert.equal(inputFromReport({ ...base, request: { point: { lat: 52, lon: 19 } }, parcel: { id: 'TEST' } }).test, true);
  assert.equal(inputFromReport({ ...base, generated_at: '2026-07-01T06:00:00Z', request: { parcel_id: 'x' } }).date, null);
});

test('stan na ostatni dzień z pogodą i jedna definicja sezonów z niedoborem', () => {
  assert.equal(daysBetween('2026-11-15', '2026-11-22'), 7);
  assert.equal(daysBetween('2026-03-28', '2026-03-30'), 2);   // zmiana czasu nie psuje liczby dni
  assert.equal(daysBetween(null, '2026-11-22'), 0);
  const seasons = [{ stressed: true, stress_days_critical: 3 }, { stressed: true, stress_days_critical: 20 }, { stressed: false, stress_days_critical: 0 }];
  const now = stressSeasons({ seasons_with_stress: 2, seasons_with_long_stress: 1, long_stress_days: 14 });
  assert.equal(now.count, 1);
  assert.deepEqual(seasons.map(now.isStressed), [false, true, false]);
  const saved = stressSeasons({ seasons_with_stress: 2 });   // raport zapisany przed zmianą
  assert.equal(saved.count, 2);
  assert.deepEqual(seasons.map(saved.isStressed), [true, true, false]);
});

test('wyróżnione działanie to pierwsze „na teraz”, a nie pierwsze z listy', () => {
  const later = { key: 'residue_cover', timing: 'after_harvest' }, now = { key: 'monitor_field', timing: 'now' };
  assert.equal(firstAction([later, { key: 'organic_matter', timing: 'long_term' }, now]), now);
  assert.equal(firstAction([{ key: 'organic_matter', timing: 'long_term' }, later]), later);
  assert.equal(firstAction([{ key: 'old' }, { key: 'older' }]).key, 'old');   // zapisane raporty bez terminu
});
