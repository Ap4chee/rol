import assert from 'node:assert/strict';
import test from 'node:test';
import { markSeen, nextTour, placeCard, readSeen, scrollDelta, SEEN_KEY, seenAfter, spotlightRect, unionRect } from './logic.js';

function memory(initial = {}) {
  const data = { ...initial };
  return { getItem: (key) => data[key] ?? null, setItem: (key, value) => { data[key] = value; }, data };
}

test('pamięć samouczka: zapis, odczyt i odporność na śmieci', () => {
  const storage = memory();
  assert.deepEqual(readSeen(storage), {});
  assert.deepEqual(markSeen(storage, ['welcome']), { welcome: true });
  assert.deepEqual(markSeen(storage, ['report']), { welcome: true, report: true });
  assert.deepEqual(readSeen(memory({ [SEEN_KEY]: 'nie json' })), {});
  assert.deepEqual(readSeen(memory({ [SEEN_KEY]: '[1]' })), {});
  // brak dostępu do pamięci przeglądarki nie przerywa pracy
  const broken = { getItem() { throw new Error('zablokowane'); }, setItem() { throw new Error('zablokowane'); } };
  assert.deepEqual(readSeen(broken), {});
  assert.deepEqual(markSeen(broken, ['welcome']), { welcome: true });
});

test('powitanie na pulpicie, objaśnienie raportu przy pierwszym gotowym raporcie', () => {
  const at = (page, extra = {}) => ({ seen: {}, page, tab: 'podsumowanie', hasReport: false, ...extra });
  assert.equal(nextTour(at('dashboard')), 'welcome');
  assert.equal(nextTour(at('dashboard', { seen: { welcome: true } })), null);
  assert.equal(nextTour(at('map')), null);
  assert.equal(nextTour(at('field')), null);   // raport jeszcze się liczy
  assert.equal(nextTour(at('field', { hasReport: true })), 'report');
  assert.equal(nextTour(at('field', { hasReport: true, tab: 'gleba' })), null);
  assert.equal(nextTour(at('field', { hasReport: true, seen: { report: true } })), null);
});

test('pominięcie powitania wyłącza też objaśnienie raportu, przejście do końca nie', () => {
  assert.deepEqual(seenAfter('welcome', 'skip'), ['welcome', 'report']);
  assert.deepEqual(seenAfter('welcome', 'add'), ['welcome']);
  assert.deepEqual(seenAfter('welcome', 'done'), ['welcome']);
  assert.deepEqual(seenAfter('report', 'skip'), ['report']);
});

test('wspólny prostokąt sąsiednich elementów', () => {
  assert.equal(unionRect([]), null);
  assert.deepEqual(unionRect([{ x: 12, y: 100, w: 220, h: 36 }, { x: 12, y: 138, w: 220, h: 36 }]), { x: 12, y: 100, w: 220, h: 74 });
});

const DESKTOP = { w: 1280, h: 800 }, PHONE = { w: 390, h: 844 };

test('komputer: karta bez celu na środku, przy menu po prawej, pod przyciskiem z prawej strony ekranu dosunięta do krawędzi', () => {
  const card = { w: 420, h: 260 };
  assert.deepEqual(placeCard({ target: null, card, area: DESKTOP }), { x: 430, y: 270, side: 'none' });
  const menu = placeCard({ target: { x: 12, y: 100, w: 224, h: 74 }, card, area: DESKTOP, prefer: 'right' });
  assert.deepEqual(menu, { x: 250, y: 76, side: 'right' });
  const button = placeCard({ target: { x: 1120, y: 60, w: 120, h: 40 }, card, area: DESKTOP });
  assert.deepEqual(button, { x: 848, y: 114, side: 'bottom' });
});

test('komputer: gdy z wybranej strony nie ma miejsca, karta staje z innej, a przy celu na cały ekran na dole', () => {
  const card = { w: 420, h: 260 };
  // cel przy prawej krawędzi: po prawej się nie mieści, więc pod spodem
  assert.equal(placeCard({ target: { x: 1100, y: 200, w: 160, h: 60 }, card, area: DESKTOP, prefer: 'right' }).side, 'bottom');
  const huge = placeCard({ target: { x: 280, y: 60, w: 980, h: 700 }, card, area: DESKTOP });
  assert.equal(huge.side, 'dock-bottom');
  assert.equal(huge.y, 800 - 260 - 12);
});

test('telefon: karta na dole, a gdy zasłoniłaby cel, na górze', () => {
  const card = { w: 366, h: 240 };
  assert.deepEqual(placeCard({ target: null, card, area: PHONE, narrow: true }), { x: 12, y: 592, side: 'none' });
  assert.equal(placeCard({ target: { x: 8, y: 8, w: 40, h: 40 }, card, area: PHONE, narrow: true }).side, 'dock-bottom');
  const low = placeCard({ target: { x: 120, y: 640, w: 150, h: 48 }, card, area: PHONE, narrow: true });
  assert.deepEqual(low, { x: 12, y: 12, side: 'dock-top' });
  // cel wyższy niż wolne miejsce: karta zostaje na dole, bo najważniejsze jest u góry celu
  assert.equal(placeCard({ target: { x: 16, y: 112, w: 358, h: 620 }, card, area: PHONE, narrow: true }).side, 'dock-bottom');
  assert.equal(placeCard({ target: { x: 16, y: 112, w: 358, h: 700 }, card: { w: 366, h: 289 }, area: PHONE, narrow: true }).side, 'dock-bottom');
});

test('podświetlenie nie wchodzi pod kartę przy krawędzi ekranu', () => {
  const card = { w: 366, h: 240 }, target = { x: 16, y: 112, w: 358, h: 620 };
  const placed = placeCard({ target, card, area: PHONE, narrow: true });
  const spot = spotlightRect({ target, area: PHONE, placed, card });
  assert.equal(spot.y, 106);
  assert.equal(spot.y + spot.h, placed.y - 10);
  // cel mieszczący się w całości dostaje sam margines
  assert.deepEqual(spotlightRect({ target: { x: 100, y: 100, w: 80, h: 40 }, area: DESKTOP, placed: { x: 0, y: 200, side: 'bottom' }, card }),
    { x: 94, y: 94, w: 92, h: 52 });
});

test('przewijanie: widoczny cel zostaje, schowany pod kartą podjeżdża, za wysoki staje górą pod paskami', () => {
  const card = { w: 366, h: 240 };
  const args = { card, area: PHONE, narrow: true, topInset: 112 };
  assert.equal(scrollDelta({ ...args, target: { x: 16, y: 200, w: 358, h: 200 } }), 0);
  // wolne miejsce kończy się na 844 − 12 − 240 − 14 = 578
  assert.equal(scrollDelta({ ...args, target: { x: 16, y: 500, w: 358, h: 200 } }), 122);
  assert.equal(scrollDelta({ ...args, target: { x: 16, y: 380, w: 358, h: 620 } }), 268);
  assert.equal(scrollDelta({ ...args, target: { x: 16, y: 20, w: 358, h: 100 } }), -92);
  // powrót pod sam początek strony kończy się na początku, jeśli cel dalej mieści się nad kartą
  assert.equal(scrollDelta({ ...args, scrollY: 248, target: { x: 16, y: -40, w: 358, h: 52 } }), -248);
  assert.equal(scrollDelta({ ...args, scrollY: 900, target: { x: 16, y: -40, w: 358, h: 52 } }), -152);
  assert.equal(scrollDelta({ ...args, scrollY: 0, target: { x: 16, y: 200, w: 358, h: 200 } }), 0);
  // komputer, karta obok celu: dół ekranu jest wolny
  assert.equal(scrollDelta({ target: { x: 12, y: 500, w: 224, h: 74 }, card: { w: 420, h: 260 }, area: DESKTOP, prefer: 'right' }), 0);
});
