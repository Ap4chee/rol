import assert from 'node:assert/strict';
import { test } from 'node:test';
import { initialSelection, insidePoland, isReady, OUTSIDE_AREA, POINT_ONLY, selectionReducer } from './parcelSelection.js';

const parcel = { id: '060910_2.0011.580/2', number: '580/2' };
const other = { id: '060910_2.0011.581', number: '581' };
const run = (events, state = initialSelection()) => events.reduce(selectionReducer, state);

test('klik poza Polską po wcześniejszym wyborze nie zostawia gotowej działki', () => {
  const chosen = run([{ type: 'start', seq: 1 }, { type: 'selected', seq: 1, parcel }]);
  assert.equal(isReady(chosen), true);
  assert.equal(insidePoland({ lat: 50.1, lon: 13.5 }), false);
  const rejected = selectionReducer(chosen, { type: 'reject', seq: 2, text: OUTSIDE_AREA });
  assert.equal(isReady(rejected), false);
  assert.equal(rejected.parcel, null);
  assert.deepEqual(rejected.problem, { kind: 'failure', text: OUTSIDE_AREA });
});

test('szybkie kliknięcia: wygrywa ostatnie, spóźniona odpowiedź pierwszego jest pomijana', () => {
  const state = run([
    { type: 'start', seq: 1 }, { type: 'start', seq: 2 },
    { type: 'selected', seq: 2, parcel: other }, { type: 'selected', seq: 1, parcel },
  ]);
  assert.equal(state.parcel, other);
});

test('edycja tekstu w trakcie sprawdzania unieważnia wybór i odpowiedź', () => {
  const state = run([{ type: 'start', seq: 1 }, { type: 'edit', seq: 2, query: '58' }, { type: 'selected', seq: 1, parcel }]);
  assert.equal(state.parcel, null);
  assert.equal(state.query, '58');
  assert.equal(state.checking, false);
  assert.equal(isReady(state), false);
});

test('w trakcie sprawdzania formularz nie jest gotowy, nawet z punktem', () => {
  const state = run([{ type: 'start', seq: 1 }]);
  assert.equal(state.checking, true);
  assert.equal(isReady(state), false);
});

test('brak działki to co innego niż błąd usługi', () => {
  const none = run([{ type: 'start', seq: 1 }, { type: 'notFound', seq: 1, text: 'W tym miejscu nie ma działki.' }]);
  const down = run([{ type: 'start', seq: 1 }, { type: 'failed', seq: 1, text: 'Usługa działek nie odpowiedziała.' }]);
  assert.equal(none.problem.kind, 'not_found');
  assert.equal(down.problem.kind, 'failure');
  assert.equal(isReady(none) || isReady(down), false);
});

test('awaria usługi działek przy kliknięciu daje raport dla punktu', () => {
  const state = run([{ type: 'start', seq: 1 }, { type: 'pointOnly', seq: 1, point: { lat: 51, lon: 22 } }]);
  assert.equal(isReady(state), true);
  assert.equal(state.message, POINT_ONLY);
});

test('nieudany wybór z listy zostawia listę kandydatów', () => {
  const list = [{ id: parcel.id }, { id: other.id }];
  const state = run([
    { type: 'start', seq: 1 }, { type: 'candidates', seq: 1, list, truncated: false },
    { type: 'start', seq: 2, keepCandidates: true }, { type: 'failed', seq: 2, text: 'HTTP 502' },
  ]);
  assert.equal(state.candidates, list);
  assert.equal(isReady(state), false);
});

test('przeliczanie zapisanego pola zaczyna od jego działki albo punktu', () => {
  const withParcel = initialSelection({ report: { request: { parcel_id: parcel.id }, parcel } });
  assert.equal(isReady(withParcel), true);
  assert.equal(withParcel.query, parcel.id);
  const withPoint = initialSelection({ report: { request: { point: { lat: 51, lon: 22 } }, parcel: null } });
  assert.deepEqual(withPoint.point, { lat: 51, lon: 22 });
});
