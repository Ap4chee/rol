import assert from 'node:assert/strict';
import test from 'node:test';
import { fieldsCount } from '../../shared/format/plural.js';
import { blendLook, fieldTeryt, lerp, lookOf, unitName, unitRole } from './logic.js';

const withParcel = (id) => ({ report: { parcel: id ? { id } : null } });

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

test('wygląd jednostki: z polami zielona, bez pól szara, sąsiedzi tylko konturem', () => {
  assert.deepEqual(lookOf('06', 3, '', null).fill, [141, 197, 159, 1]);
  assert.deepEqual(lookOf('06', 3, '', '06').fill, [94, 166, 118, 1]);
  assert.deepEqual(lookOf('14', 0, '', null).fill, [219, 219, 212, 1]);
  assert.equal(lookOf('14', 0, '0609', null).fill[3], 0);
  assert.equal(lookOf('0609', 1, '0609102', null), null);
});

test('przejście między poziomami miesza wygląd i wygasza znikające jednostki', () => {
  const start = blendLook('06', 2, { from: '', to: '06', t: 0, hover: null });
  const end = blendLook('06', 2, { from: '', to: '06', t: 1, hover: null });
  assert.equal(start.badge, 1);
  // województwo, w które weszliśmy, gaśnie razem z plakietką
  assert.equal(end.fill[3], 0);
  assert.equal(end.badge, 0);
  assert.equal(blendLook('0101', 0, { from: '06', to: '0609', t: 0.3, hover: null }), null);   // powiat innego województwa
  const appear = blendLook('0609', 1, { from: '', to: '06', t: 0.5, hover: null });
  assert.equal(appear.fill[3], 0.5);
  assert.equal(appear.badge, 0.5);
  assert.equal(appear.zIndex, 1);
  assert.equal(lerp(2, 4, 0.25), 2.5);
  assert.equal(unitName({ kod: '06', nazwa: 'lubelskie' }), 'województwo lubelskie');
  assert.equal(unitName({ kod: '0609', nazwa: 'lubelski' }), 'lubelski');
});
