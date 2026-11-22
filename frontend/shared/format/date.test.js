import assert from 'node:assert/strict';
import test from 'node:test';
import { addDays, dateText, dayMonth, dayName, daysBetween, MONTHS, oldestDate, today } from './date.js';

test('dzisiejsza data w formacie ISO', () => {
  assert.match(today(), /^\d{4}-\d{2}-\d{2}$/);
});

test('najstarsza data analizy to 10 lat wstecz, 29 lutego przechodzi na 28', () => {
  assert.equal(oldestDate('2026-07-15'), '2016-07-15');
  assert.equal(oldestDate('2024-02-29'), '2014-02-28');
});

test('daty do tekstu', () => {
  assert.equal(dateText('2026-07-15'), '15.07.2026');
  assert.equal(dateText('2026-07-15T05:00:00Z'), '15.07.2026');
  assert.equal(dateText(null), '—');
  assert.equal(dayMonth('2026-07-05'), '05.07');
  assert.equal(MONTHS[6], 'lip');
});

test('liczenie dni między datami i przesuwanie daty', () => {
  assert.equal(daysBetween('2026-03-01', '2026-03-31'), 30);
  assert.equal(daysBetween('2026-10-24', '2026-10-26'), 2);   // przez zmianę czasu
  assert.equal(daysBetween(null, '2026-03-31'), 0);
  assert.equal(addDays('2026-02-27', 2), '2026-03-01');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
});

test('dzień tygodnia bez kropki, dzisiejszy jako „dziś”', () => {
  assert.equal(dayName('2026-11-23', '2026-11-22'), 'pon');
  assert.equal(dayName('2026-11-22', '2026-11-22'), 'dziś');
  // dzień zmiany czasu: południe UTC daje ten sam dzień w UTC i w czasie polskim
  assert.equal(dayName('2026-03-29', ''), new Intl.DateTimeFormat('pl-PL', { weekday: 'short', timeZone: 'UTC' })
    .format(new Date('2026-03-29T12:00:00Z')).replace('.', ''));
});
