import assert from 'node:assert/strict';
import { test } from 'node:test';
import { completeReport, MAX_POLLS, mergeSatellite, nextStep, STILL_PENDING } from './completion.js';

const idle = { result: null, failure: '', exhausted: false };
const report = {
  satellite: { status: 'pending', endpoint: '/api/satellite?x', observations: [] },
  terrain: { status: 'pending', endpoint: '/api/terrain?x' },
  sources: [{ key: 'weather', status: 'ok' }, { key: 'satellite', status: 'pending' }, { key: 'terrain', status: 'pending' }],
  recommendations: { field_checks: [{ key: 'check_soil_texture' }] },
};
const satDone = {
  satellite: { status: 'ok', observations: [{ date: '2026-07-01' }] },
  source: { key: 'satellite', status: 'ok' },
  field_checks: [{ key: 'satellite_divergence' }],
};

test('ponowne „pending” prowadzi do kolejnego zapytania, a po limicie do „Ponów”', () => {
  const pending = { satellite: { status: 'pending' } };
  assert.equal(nextStep('satellite', pending, 0), 'poll');
  assert.equal(nextStep('satellite', pending, MAX_POLLS), 'exhausted');
  assert.equal(nextStep('satellite', satDone, 0), 'done');
  assert.equal(nextStep('terrain', { status: 'pending' }, 1), 'poll');
  assert.equal(nextStep('terrain', { status: 'error', reason: 'NMT' }, 1), 'done');
});

test('po limicie prób widok pokazuje błąd zamiast wiecznego oczekiwania', () => {
  const view = completeReport(report, { result: { satellite: { status: 'pending', observations: [{ date: 'd' }] } }, failure: '', exhausted: true }, idle);
  assert.equal(view.satellite.status, 'error');
  assert.equal(view.satellite.reason, STILL_PENDING);
  assert.equal(view.satellite.observations.length, 1);   // wczytane już zdjęcia zostają
});

test('błąd sieci a błąd źródła: oba kończą się błędem, z własnym powodem', () => {
  const network = completeReport(report, { ...idle, failure: 'Błąd odpowiedzi serwera (502).' }, idle);
  assert.deepEqual([network.satellite.status, network.satellite.reason], ['error', 'Błąd odpowiedzi serwera (502).']);
  const source = completeReport(report, idle, { ...idle, result: { status: 'error', reason: 'WCS NMT nie odpowiada', source: { key: 'terrain', status: 'error' } } });
  assert.deepEqual([source.terrain.status, source.terrain.reason], ['error', 'WCS NMT nie odpowiada']);
  assert.equal(source.sources.find((s) => s.key === 'terrain').status, 'error');
});

test('scalony raport ma te same źródła na ekranie, w wydruku i w zapisie', () => {
  const view = completeReport(report, { ...idle, result: satDone }, { ...idle, result: { status: 'ok', source: { key: 'terrain', status: 'ok' } } });
  const saved = mergeSatellite(report, satDone);
  assert.deepEqual(view.sources.map((s) => [s.key, s.status]), [['weather', 'ok'], ['satellite', 'ok'], ['terrain', 'ok']]);
  assert.deepEqual(saved.sources.filter((s) => s.key !== 'terrain'), view.sources.filter((s) => s.key !== 'terrain'));
  assert.deepEqual(view.satellite, saved.satellite);
  assert.deepEqual(view.recommendations.field_checks.map((c) => c.key), ['check_soil_texture', 'satellite_divergence']);
});

test('ponowne scalenie nie dubluje sprawdzeń w polu', () => {
  const twice = mergeSatellite(mergeSatellite(report, satDone), satDone);
  assert.equal(twice.recommendations.field_checks.length, 2);
  assert.equal(twice.sources.filter((s) => s.key === 'satellite').length, 1);
});

test('bez dociągniętych części widać stan z raportu', () => {
  const view = completeReport(report, idle, idle);
  assert.equal(view.satellite, report.satellite);
  assert.equal(view.terrain, report.terrain);
});
