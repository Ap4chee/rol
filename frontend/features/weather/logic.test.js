import assert from 'node:assert/strict';
import test from 'node:test';
import { forecastStops, rainText, rangeLabel } from './logic.js';

test('karuzela zatrzymuje się na pełnych tygodniach, bez pustego końca', () => {
  assert.deepEqual(forecastStops(16), [0, 7, 9]);
  assert.deepEqual(forecastStops(14), [0, 7]);
  assert.deepEqual(forecastStops(7), [0]);
  assert.deepEqual(forecastStops(0), [0]);
});

test('opad w wąskiej kolumnie od 10 mm bez części dziesiętnej', () => {
  assert.equal(rainText(3.24, false), '3,2 mm');
  assert.equal(rainText(12.6, false), '13 mm');
  assert.equal(rainText(12.6, true), '12,6 mm');
});

test('zakres widocznych dni', () => {
  assert.equal(rangeLabel({ date: '2026-11-22' }, { date: '2026-11-28' }, '2026-11-22'), 'dziś – 28.11');
  assert.equal(rangeLabel({ date: '2026-11-29' }, { date: '2026-12-05' }, '2026-11-22'), '29.11 – 05.12');
  assert.equal(rangeLabel(undefined, undefined, '2026-11-22'), null);
});
