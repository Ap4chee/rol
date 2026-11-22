import assert from 'node:assert/strict';
import test from 'node:test';
import { describeParcel, errorText, placeGuide, submitLabel, timelineErrors, usesTimeline } from './logic.js';

test('terminy sezonu muszą iść po kolei, łąka ich nie ma', () => {
  const base = { crop: 'maize', sowingDate: '2026-04-20', harvestDate: '2026-09-30', nextSowingDate: '2026-10-10' };
  assert.deepEqual(timelineErrors(base), { harvest: '', nextSowing: '' });
  assert.equal(timelineErrors({ ...base, harvestDate: '2026-04-20' }).harvest, 'Zbiór musi przypadać po siewie lub sadzeniu.');
  assert.equal(timelineErrors({ ...base, nextSowingDate: '2026-09-01' }).nextSowing, 'Kolejny siew musi przypadać po zbiorze.');
  // bez zbioru kolejny siew porównujemy z siewem
  assert.equal(timelineErrors({ ...base, harvestDate: '', nextSowingDate: '2026-04-01' }).nextSowing, 'Kolejny siew musi przypadać po zbiorze.');
  assert.deepEqual(timelineErrors({ ...base, crop: 'grassland', harvestDate: '2026-01-01' }), { harvest: '', nextSowing: '' });
  assert.equal(usesTimeline('grassland'), false);
});

test('napis przycisku zapisu', () => {
  assert.equal(submitLabel({ editing: false }), 'Dodaj pole');
  assert.equal(submitLabel({ editing: true, renameOnly: true, sameInputs: true }), 'Zapisz nazwę');
  assert.equal(submitLabel({ editing: true, renameOnly: false, sameInputs: true }), 'Zapisz');
  assert.equal(submitLabel({ editing: true, renameOnly: false, sameInputs: false }), 'Zapisz i przelicz');
});

test('opis działki i przewodnik wskazania pola', () => {
  assert.equal(describeParcel({ region: 'Niedrzwica', commune: 'Niedrzwica Duża', voivodeship: 'lubelskie' }),
    'Niedrzwica, gm. Niedrzwica Duża, lubelskie');
  assert.equal(describeParcel({}), '');
  assert.equal(placeGuide({ found: false, chosen: false }).at, 0);
  assert.equal(placeGuide({ found: true, chosen: false }).at, 1);
  assert.equal(placeGuide({ found: true, chosen: true }).at, 2);
});

test('przekroczony czas po ludzku', () => {
  assert.equal(errorText(Object.assign(new Error('x'), { name: 'TimeoutError' })), 'Serwer nie odpowiedział na czas. Spróbuj ponownie.');
  assert.equal(errorText(new Error('Nie znaleziono działki.')), 'Nie znaleziono działki.');
});
