import assert from 'node:assert/strict';
import test from 'node:test';
import { degrees, fixed, minus, mm, number } from './number.js';

test('liczba po polsku, brak wartości jako kreska, bez „-0”', () => {
  assert.equal(number(12.56, 1), '12,6');
  assert.equal(number(0.4), '0');
  assert.equal(number(-0.04, 1), '0');
  assert.equal(number(null), '—');
  assert.equal(number(NaN), '—');
});

test('minus typograficzny, milimetry i stopnie', () => {
  assert.equal(minus('-12 mm'), '−12 mm');
  assert.equal(mm(12.34, 1), '12,3 mm');
  assert.equal(mm(7), '7 mm');
  assert.equal(degrees(-3.2), '−3°');
  assert.equal(degrees(18), '18°');
});

test('stała liczba miejsc po przecinku', () => {
  assert.equal(fixed(0.2, 2), '0,20');
  assert.equal(fixed(-0.051, 2), '-0,05');
  assert.equal(fixed(undefined, 2), '—');
});
