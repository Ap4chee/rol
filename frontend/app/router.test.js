import assert from 'node:assert/strict';
import test from 'node:test';
import { fieldHref, fieldTabHref, mapCode, mapHref, pageOf, routeTab } from './router.js';

test('identyfikator z ukośnikiem i nietypowym numerem przechodzi przez adres bez zmian', () => {
  const id = '022602_1.0003.AR_4.59/2';
  assert.equal(routeTab(fieldHref(id)).id, id);
  assert.equal(routeTab('#pole/%').id, null);
});

test('adres pola niesie zakładkę, a identyfikator z ukośnikiem przechodzi bez zmian', () => {
  const id = '060910_2.0011.580/2';
  assert.deepEqual(routeTab(fieldHref(id)), { id, tab: 'podsumowanie' });
  assert.deepEqual(routeTab(fieldTabHref(id, 'gleba')), { id, tab: 'gleba' });
  assert.deepEqual(routeTab(fieldTabHref(id, 'nieznana')), { id, tab: 'podsumowanie' });
  assert.deepEqual(routeTab('#podglad/pogoda'), { id: 'preview', tab: 'pogoda' });
  assert.equal(fieldTabHref('preview', 'gleba'), '#podglad/gleba');
  assert.equal(routeTab('#dodaj').id, null);
});

test('poziom mapy z adresu i z powrotem', () => {
  assert.equal(mapCode('#mapa'), '');
  assert.equal(mapCode('#mapa/0609102'), '0609102');
  assert.equal(mapCode('#mapa/123'), '');
  assert.equal(mapCode('#plan'), null);
  assert.equal(mapHref(''), '#mapa');
  assert.equal(mapHref('06'), '#mapa/06');
});

test('strona z adresu', () => {
  assert.equal(pageOf('#pole/x', true), 'field');
  assert.equal(pageOf('#pole/x', false), 'dashboard');
  assert.equal(pageOf('#mapa/06', false), 'map');
  assert.equal(pageOf('#plan', false), 'plan');
  assert.equal(pageOf('', false), 'dashboard');
});
