import assert from 'node:assert/strict';
import test from 'node:test';
import { fieldsCount, fieldTeryt, mapCode, unitRole } from './fieldsMap.js';

const withParcel = (id) => ({ report: { parcel: id ? { id } : null } });

test('mapCode czyta poziom mapy z adresu', () => {
  assert.equal(mapCode('#mapa'), '');
  assert.equal(mapCode('#mapa/06'), '06');
  assert.equal(mapCode('#mapa/0609'), '0609');
  assert.equal(mapCode('#mapa/0609102'), '0609102');
  assert.equal(mapCode('#mapa/123'), '');
  assert.equal(mapCode('#pole/x'), null);
  assert.equal(mapCode(''), null);
});

test('fieldTeryt: gmina z numeru działki, z dzielnicami i gminami miejsko-wiejskimi', () => {
  assert.equal(fieldTeryt(withParcel('060910_2.0011.580/2')), '0609102');
  assert.equal(fieldTeryt(withParcel('146518_8.0101.12')), '1465011');      // dzielnica Warszawy
  assert.equal(fieldTeryt(withParcel('061402_4.0001.AR_1.5')), '0614023');  // miasto w gminie miejsko-wiejskiej
  assert.equal(fieldTeryt(withParcel('061402_5.0003.7')), '0614023');       // obszar wiejski tej gminy
  assert.equal(fieldTeryt(withParcel(null)), null);
  assert.equal(fieldTeryt({ report: null, input: { parcel_id: '060910_2.0011.580/2' } }), '0609102');   // raport w toku
  assert.equal(fieldTeryt({ report: null, input: { point: { lat: 52, lon: 21 } } }), null);
});

test('unitRole: dzieci widoku aktywne, sąsiedzi w tle, reszta ukryta', () => {
  assert.equal(unitRole('06', ''), 'active');
  assert.equal(unitRole('0609', ''), null);
  assert.equal(unitRole('06', '06'), null);
  assert.equal(unitRole('14', '06'), 'context');
  assert.equal(unitRole('0609', '06'), 'active');
  assert.equal(unitRole('1465', '06'), null);
  assert.equal(unitRole('0609102', '06'), null);
  assert.equal(unitRole('0609102', '0609'), 'active');
  assert.equal(unitRole('0610', '0609'), 'context');
  assert.equal(unitRole('0610011', '0609'), null);
  assert.equal(unitRole('0609102', '0609102'), 'self');
  assert.equal(unitRole('0609082', '0609102'), 'context');
  assert.equal(unitRole('0609', '0609102'), null);
  assert.equal(unitRole('14', '0609102'), 'context');
});

test('fieldsCount odmienia „pole”', () => {
  assert.deepEqual([1, 2, 5, 12, 22, 0].map(fieldsCount), ['1 pole', '2 pola', '5 pól', '12 pól', '22 pola', '0 pól']);
});
