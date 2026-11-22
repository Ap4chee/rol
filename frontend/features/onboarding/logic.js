// Samouczek (Onboarding.jsx): co już pokazano i geometria karty z opisem względem podświetlonego elementu.
// Bez importów, żeby testy (`node --test`) mogły wczytać plik bez Reacta.

export const SEEN_KEY = 'kowr.onboarding.v1';

/** Które części samouczka ta przeglądarka już widziała: `{ welcome?: true, report?: true }`. */
export function readSeen(storage) {
  try {
    const seen = JSON.parse(storage.getItem(SEEN_KEY) ?? '{}');
    return seen && typeof seen === 'object' && !Array.isArray(seen) ? seen : {};
  } catch {
    return {};
  }
}

export function markSeen(storage, ids) {
  const seen = { ...readSeen(storage) };
  for (const id of ids) seen[id] = true;
  try { storage.setItem(SEEN_KEY, JSON.stringify(seen)); } catch { /* bez zapisu samouczek pokaże się ponownie */ }
  return seen;
}

/** Część samouczka do pokazania samoczynnie: powitanie na pulpicie, potem objaśnienie pierwszego otwartego raportu. */
export function nextTour({ seen, page, tab, hasReport }) {
  if (page === 'dashboard' && !seen.welcome) return 'welcome';
  if (page === 'field' && hasReport && tab === 'podsumowanie' && !seen.report) return 'report';
  return null;
}

/** Zamknięcie: pominięte powitanie wyłącza też objaśnienie raportu (rolnik nie chce podpowiedzi). */
export function seenAfter(tour, reason) {
  return tour === 'welcome' && reason === 'skip' ? ['welcome', 'report'] : [tour];
}

const clamp = (value, low, high) => Math.min(Math.max(value, low), Math.max(low, high));
const SNAP_TO_TOP = 200;   // przewinięcie, które skończyłoby się bliżej niż tyle px od początku strony, wraca na początek
const SIDE_LEAD = 24;   // o ile karta stojąca obok celu zaczyna się nad jego górną krawędzią (px)

/** Wspólny prostokąt kilku elementów (np. dwie sąsiednie pozycje menu). Współrzędne okna, px. */
export function unionRect(rects) {
  if (!rects.length) return null;
  const x1 = Math.min(...rects.map((r) => r.x)), y1 = Math.min(...rects.map((r) => r.y));
  const x2 = Math.max(...rects.map((r) => r.x + r.w)), y2 = Math.max(...rects.map((r) => r.y + r.h));
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/**
 * Gdzie stanąć z kartą (lewy górny róg, px). `target`: prostokąt podświetlonego elementu albo null (karta bez celu).
 * Telefon (`narrow`): karta na dole ekranu, a gdy zasłoniłaby cel, na górze. Komputer: obok celu po stronie `prefer`,
 * a gdy się nie mieści, po kolejnej. Cel na większość ekranu → karta na dole, bo najważniejsze jest u góry celu
 * (podświetlenie jest wtedy przycinane nad kartą).
 * `side`: po której stronie celu stoi karta ('dock-bottom' / 'dock-top' = przy krawędzi ekranu, 'none' = bez celu).
 */
export function placeCard({ target, card, area, narrow = false, prefer = 'bottom', gap = 14, margin = 12 }) {
  const maxX = area.w - card.w - margin, maxY = area.h - card.h - margin;
  const centerX = Math.max(margin, (area.w - card.w) / 2);
  if (narrow) {
    if (!target) return { x: centerX, y: Math.max(margin, maxY), side: 'none' };
    if (target.y + target.h + gap <= maxY) return { x: centerX, y: maxY, side: 'dock-bottom' };
    if (target.y - gap >= margin + card.h) return { x: centerX, y: margin, side: 'dock-top' };
    return { x: centerX, y: Math.max(margin, maxY), side: 'dock-bottom' };
  }
  if (!target) return { x: centerX, y: Math.max(margin, (area.h - card.h) / 2), side: 'none' };
  const alignX = clamp(target.x + target.w / 2 - card.w / 2, margin, maxX);
  // obok niskiego celu (przycisk, pozycje menu) karta zaczyna się tuż nad nim, a nie w połowie: zasłania mniej treści wyżej
  const alignY = clamp(target.h >= card.h ? target.y + target.h / 2 - card.h / 2 : target.y - SIDE_LEAD, margin, maxY);
  const options = {
    bottom: { x: alignX, y: target.y + target.h + gap },
    right: { x: target.x + target.w + gap, y: alignY },
    left: { x: target.x - gap - card.w, y: alignY },
    top: { x: alignX, y: target.y - gap - card.h },
  };
  const fits = ({ x, y }) => x >= margin && x <= maxX && y >= margin && y <= maxY;
  const side = [prefer, ...Object.keys(options).filter((key) => key !== prefer)].find((key) => fits(options[key]));
  if (side) return { ...options[side], side };
  return { x: alignX, y: Math.max(margin, maxY), side: 'dock-bottom' };
}

/**
 * Prostokąt podświetlenia: cel z marginesem `pad`, przycięty do ekranu i do miejsca nad (pod) kartą przy krawędzi,
 * żeby karta nigdy nie leżała na podświetleniu.
 */
export function spotlightRect({ target, area, placed, card, pad = 6, gap = 10 }) {
  let top = 6, bottom = area.h - 6;
  if (placed?.side === 'dock-bottom') bottom = Math.min(bottom, placed.y - gap);
  if (placed?.side === 'dock-top') top = Math.max(top, placed.y + card.h + gap);
  const x1 = Math.max(target.x - pad, 4), x2 = Math.min(target.x + target.w + pad, area.w - 4);
  const y1 = Math.max(target.y - pad, top), y2 = Math.min(target.y + target.h + pad, bottom);
  return { x: x1, y: y1, w: Math.max(0, x2 - x1), h: Math.max(0, y2 - y1) };
}

/**
 * O ile przewinąć stronę (px, dodatnio w dół), żeby cel był widoczny obok karty. `topInset`: ile miejsca u góry
 * zajmują przyklejone paski (cel nie może pod nie wjechać). Cel wyższy niż wolne miejsce staje górą przy górnej
 * krawędzi. `scrollY`: bieżące przewinięcie; gdy po ruchu strona stałaby tuż pod początkiem, a cel mieści się też
 * przy samym początku, wracamy na samą górę (nagłówek strony widać wtedy w całości).
 * Wynik trzeba jeszcze ograniczyć do zakresu przewijania strony.
 */
export function scrollDelta({ target, card, area, narrow = false, prefer = 'bottom', topInset = 0, gap = 14, margin = 12, scrollY }) {
  const top = topInset;
  // karta pod celem (telefon, komputer przy `bottom`) zabiera dół ekranu; obok celu nie zabiera nic
  const below = narrow || prefer === 'bottom' || prefer === 'top';
  const bottom = below ? area.h - margin - card.h - gap : area.h - margin;
  const delta = target.y >= top && target.y + target.h <= bottom ? 0
    : target.h > bottom - top || target.y < top ? target.y - top
      : target.y + target.h - bottom;
  const next = scrollY + delta;
  if (delta && next > 0 && next < SNAP_TO_TOP && target.y + scrollY + target.h <= bottom) return -scrollY;
  return delta;
}
