import assert from 'node:assert/strict';
import { test } from 'node:test';
import { actionItems, fieldFromReport, fieldHref, FULL_ID, oldestDate, readFields, route, satelliteMeasurements, seasonMonths, upsertField, waterPercent } from './model.js';

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

test('zadania biorą zalecenia z raportów i wskazują najpierw silny niedobór', () => {
  const field = (id, key, recommendations) => ({ id, report: { water_status: { class_key: key }, recommendations } });
  const entries = [field('a', 'moderate', { retention: [{ title: 'Zatrzymaj wodę' }] }),
    field('b', 'severe', { irrigation: [{ title: 'Podlej' }] }), field('c', 'none', {})];
  assert.deepEqual(actionItems(entries).map((item) => item.action.title), ['Podlej', 'Zatrzymaj wodę']);
});
