import assert from 'node:assert/strict';
import test from 'node:test';
import { outlinePath, polygonRings } from './outline.js';

test('kwadrat na równiku wypełnia środek pola 100×100', () => {
  const square = { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] };
  assert.equal(outlinePath(square), 'M8.0,92.0L92.0,92.0L92.0,8.0L8.0,8.0L8.0,92.0Z');
});

test('bez wielokąta nie ma sylwetki', () => {
  assert.equal(outlinePath({ type: 'Point', coordinates: [21, 52] }), null);
  assert.equal(outlinePath(null), null);
  assert.deepEqual(polygonRings({ type: 'MultiPolygon', coordinates: [[[[0, 0], [1, 1]]]] }), []);
});
