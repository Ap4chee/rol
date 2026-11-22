import assert from 'node:assert/strict';
import test from 'node:test';
import { FIELD_SIZE, inside, parcelShape } from './shape.js';

const square = [[0, 0], [2, 0], [2, 2], [0, 2]];

test('punkt w pierścieniu i poza nim', () => {
  assert.equal(inside([1, 1], square), true);
  assert.equal(inside([3, 1], square), false);
  assert.equal(inside([-0.1, 1], square), false);
});

test('bez geometrii prostokąt umowny, z geometrią dłuższy bok ma FIELD_SIZE', () => {
  assert.equal(parcelShape(null).assumed, true);
  const lat = 52, lon = 21, d = 0.001;
  // działka wydłużona w kierunku północ–południe: po obrocie leży dłuższą osią poziomo
  const shape = parcelShape({ type: 'Polygon', coordinates: [[[lon, lat], [lon + d, lat], [lon + d, lat + 3 * d], [lon, lat + 3 * d], [lon, lat]]] });
  const xs = shape.outer.map(([x]) => x), ys = shape.outer.map(([, y]) => y);
  assert.ok(Math.abs(Math.max(...xs) - Math.min(...xs) - FIELD_SIZE) < 1e-9);
  assert.ok(Math.max(...ys) - Math.min(...ys) < FIELD_SIZE);
  assert.ok(inside(shape.project([lon + d / 2, lat + 1.5 * d]), shape.outer));
});
