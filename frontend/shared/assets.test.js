import assert from 'node:assert/strict';
import test from 'node:test';
import { actionGroupImage, cropImage, stateImage, weatherIcon } from './assets.js';

test('ilustracje upraw, stanów i działań; brak ilustracji to undefined albo „brak”', () => {
  assert.equal(cropImage('maize'), '/design/kukurydza.png');
  assert.equal(cropImage('hemp'), undefined);
  assert.equal(stateImage('severe'), '/design/stan-silny.png');
  assert.equal(stateImage('unknown'), '/design/stan-brak.png');
  assert.equal(stateImage(undefined), '/design/stan-brak.png');
  assert.equal(actionGroupImage('field_check'), '/design/akcja-ogledziny.png');
  assert.equal(actionGroupImage('other'), undefined);
});

test('kody pogody WMO', () => {
  assert.deepEqual(weatherIcon(0), ['slonce', 'Bezchmurnie']);
  assert.deepEqual(weatherIcon(73), ['snieg', 'Śnieg']);
  assert.deepEqual(weatherIcon(61), ['deszcz', 'Opad']);
  assert.deepEqual(weatherIcon(96), ['burza', 'Burza']);
  assert.deepEqual(weatherIcon(null), [null, 'Brak danych']);
});
