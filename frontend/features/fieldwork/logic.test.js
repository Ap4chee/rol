import assert from 'node:assert/strict';
import test from 'node:test';
import { fieldworkQuery, mainObstacle, windowText } from './logic.js';

const layer = (top, bottom, sand, clay, soc) => ({ top_cm: top, bottom_cm: bottom, sand_pct: sand, clay_pct: clay, soc_g_kg: soc });

test('zapytanie bierze wierzch 0–10 cm ważony grubością warstw', () => {
  const report = { parcel: { centroid: { lat: 52.1, lon: 21.2 } }, crop: { key: 'maize' },
    soil: { layers: [layer(0, 5, 60, 10, 20), layer(5, 15, 40, 20, 10), layer(15, 30, 10, 50, 5)] } };
  const params = new URLSearchParams(fieldworkQuery(report));
  assert.equal(params.get('crop'), 'maize');
  assert.equal(params.get('sand'), '50.0');
  assert.equal(params.get('clay'), '15.0');
  assert.equal(params.get('soc'), '15.0');
});

test('bez gleby i bez węgla tylko to, co znane; bez położenia brak zapytania', () => {
  const point = { request: { point: { lat: 50, lon: 20 } }, crop: { key: 'potato' } };
  assert.equal(new URLSearchParams(fieldworkQuery({ ...point, soil: { assumed: true, layers: [layer(0, 5, 60, 10, 20)] } })).has('sand'), false);
  const noSoc = new URLSearchParams(fieldworkQuery({ ...point, soil: { layers: [layer(0, 5, 60, 10, null)] } }));
  assert.equal(noSoc.get('sand'), '60.0');
  assert.equal(noSoc.has('soc'), false);
  assert.equal(fieldworkQuery({ crop: { key: 'maize' }, request: {} }), null);
});

test('okno i główna przeszkoda', () => {
  assert.equal(windowText({ date_from: '2026-11-24', date_to: '2026-11-26' }), '24.11–26.11 (3 dni)');
  assert.equal(windowText({ date_from: '2026-11-24', date_to: '2026-11-24' }), '24.11');
  assert.equal(windowText(undefined), null);
  const days = [
    { traffic: { rating: 'avoid', reason: 'śnieg' } },
    { traffic: { rating: 'avoid', reason: 'opad 5 mm; gleba mokra' } },
    { traffic: { rating: 'caution', reason: 'gleba mokra' } },
    { traffic: { rating: 'off', reason: 'poza sezonem' } },
  ];
  assert.equal(mainObstacle(days, 'traffic'), 'gleba mokra');
  assert.equal(mainObstacle([days[3]], 'traffic'), 'poza sezonem');
});
