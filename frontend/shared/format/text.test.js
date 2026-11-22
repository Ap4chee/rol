import assert from 'node:assert/strict';
import test from 'node:test';
import { capitalize } from './text.js';

test('wielka pierwsza litera, pusty tekst bez zmian', () => {
  assert.equal(capitalize('gmina Marki'), 'Gmina Marki');
  assert.equal(capitalize('łąka'), 'Łąka');
  assert.equal(capitalize(''), '');
  assert.equal(capitalize(undefined), undefined);
});
