import assert from 'node:assert/strict';
import test from 'node:test';
import { errorMessage, request } from './client.js';

test('komunikat z tekstowego `detail`', () => {
  assert.equal(errorMessage(404, { detail: 'Nie znaleziono pola.' }), 'Nie znaleziono pola.');
});

test('błędy walidacji FastAPI sklejone w jedno zdanie', () => {
  const data = { detail: [{ msg: 'Podaj datę.' }, { msg: 'Podaj uprawę.' }] };
  assert.equal(errorMessage(422, data), 'Podaj datę. Podaj uprawę.');
});

test('bez czytelnego opisu sam kod odpowiedzi', () => {
  assert.equal(errorMessage(502, null), 'Błąd odpowiedzi serwera (502).');
  assert.equal(errorMessage(500, { detail: { code: 1 } }), 'Błąd odpowiedzi serwera (500).');
});

function withFetch(reply, run) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => { calls.push({ url, init }); return reply; };
  return run(calls).finally(() => { globalThis.fetch = original; });
}

test('`json` zamienia się w treść z nagłówkiem JSON', () => withFetch(
  { ok: true, status: 200, json: async () => ({ id: 1 }) },
  async (calls) => {
    assert.deepEqual(await request('/api/fields', { method: 'POST', json: { name: 'A' } }), { id: 1 });
    assert.equal(calls[0].init.body, '{"name":"A"}');
    assert.equal(calls[0].init.headers['Content-Type'], 'application/json');
    assert.ok(calls[0].init.signal instanceof AbortSignal);
  }));

test('odpowiedź z błędem albo bez JSON-a rzuca komunikat', () => withFetch(
  { ok: false, status: 503, json: async () => { throw new SyntaxError('brak JSON'); } },
  async () => { await assert.rejects(request('/api/fields'), { message: 'Błąd odpowiedzi serwera (503).' }); }));
