import assert from 'node:assert/strict';
import { test } from 'node:test';
import { today } from '../../shared/format/date.js';
import { actionItems, anyBusy, byUrgency, fieldFromReport, firstAction, inputFromReport, mergeFields, readFields, sameReportInputs,
  statusTone, waterPercent, withTestShape } from './logic.js';

test('pole z raportu i odczyt dawnej pamięci przeglądarki', () => {
  const id = '022602_1.0003.AR_4.59/2';
  const report = { request: { parcel_id: id }, parcel: { id, number: '59/2' }, crop: {},
    water_status: {}, causes: {}, history: {}, recommendations: {}, terrain: {}, satellite: {}, soil: {}, hydrology: {} };
  const field = fieldFromReport(report);
  assert.equal(field.name, 'Działka 59/2');
  assert.deepEqual(readFields({ getItem: () => JSON.stringify([null, field]) }), [field]);
  assert.deepEqual(readFields({ getItem: () => ']' }), []);
  assert.equal(fieldFromReport({ request: { point: { lat: 52, lon: 19 } } }).id, 'punkt:52,19');
});

test('puste dane i zero nie mają tego samego znaczenia', () => {
  assert.equal(waterPercent({ available_mm: 0, taw_mm: 78 }), 0);
  assert.equal(waterPercent({ available_mm: 15, taw_mm: 0 }), null);
  assert.equal(waterPercent({ available_mm: 22, taw_mm: 100 }), 22);
  assert.equal(waterPercent({ available_mm: 120, taw_mm: 100 }), 100);
});

test('ton stanu wody: tylko ocena „ok” ma kolor klasy', () => {
  assert.equal(statusTone({ status: 'ok', class_key: 'none' }), 'ok');
  assert.equal(statusTone({ status: 'ok', class_key: 'severe' }), 'severe');
  assert.equal(statusTone({ status: 'no_data', class_key: 'severe' }), 'unknown');
  assert.equal(statusTone(undefined), 'unknown');
});

test('zadania biorą zalecenia z raportów i wskazują najpierw silny niedobór, z pierwszeństwem retencji', () => {
  const field = (id, key, recommendations) => ({ id, report: { water_status: { class_key: key }, recommendations } });
  const entries = [field('a', 'moderate', { retention: [{ title: 'Zatrzymaj wodę' }] }),
    field('b', 'severe', { retention: [{ title: 'Okrywa gleby' }], irrigation: [{ title: 'Podlej' }] }),
    field('c', 'severe', { irrigation: [{ title: 'Podlej' }] }), field('d', 'none', {})];
  assert.deepEqual(actionItems(entries).map((item) => item.action.title), ['Okrywa gleby', 'Podlej', 'Zatrzymaj wodę']);
  assert.deepEqual(byUrgency([{ id: 'x', report: null }, ...entries]).map((f) => f.id), ['b', 'c', 'a', 'd', 'x']);
});

test('wykrywa samą zmianę nazwy i zmianę danych wejściowych', () => {
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
  assert.equal(sameReportInputs({ id: 'nowe' }, { parcel: { id: 'a' }, crop: 'maize', date: '2026-07-01' }), false);
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

test('wyróżnione działanie to pierwsze „na teraz”, a nie pierwsze z listy', () => {
  const later = { key: 'residue_cover', timing: 'after_harvest' }, now = { key: 'monitor_field', timing: 'now' };
  assert.equal(firstAction([later, { key: 'organic_matter', timing: 'long_term' }, now]), now);
  assert.equal(firstAction([{ key: 'organic_matter', timing: 'long_term' }, later]), later);
  assert.equal(firstAction([{ key: 'old' }, { key: 'older' }]).key, 'old');   // zapisane raporty bez terminu
});

test('lista z serwera: pole bez zmian zostaje tym samym obiektem, zmienione jest podmienione', () => {
  const a = { id: 'a', name: 'A', job: null, refreshed_at: '2026-11-21', report: { satellite: 'dociągnięte' } };
  const b = { id: 'b', name: 'B', job: 'running', progress: { stage: 'weather' }, report: null };
  const next = mergeFields([a, b], [{ ...a, report: {} }, { ...b, progress: { stage: 'soil' } }, { id: 'c', name: 'C' }]);
  assert.equal(next[0], a);
  assert.deepEqual(next[1].progress, { stage: 'soil' });
  assert.deepEqual(next.map((f) => f.id), ['a', 'b', 'c']);
  assert.equal(anyBusy(next), true);
  assert.equal(anyBusy([a]), false);
});

test('tryb testowy dorysowuje obrys do raportu liczonego dla punktu', () => {
  const field = { input: { test: true }, report: { request: { point: { lat: 52, lon: 19 } } } };
  const shaped = withTestShape(field);
  assert.equal(shaped.report.parcel.id, 'TEST');
  assert.equal(shaped.report.parcel.geometry.type, 'Polygon');
  assert.equal(shaped.report.test_crop_area.type, 'MultiPolygon');
  assert.equal(withTestShape({ input: { test: false }, report: field.report }).report, field.report);
});
