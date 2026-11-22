// Kody TERYT jednostek na mapie pól: województwo WW, powiat WWPP, gmina WWPPGGT
// (T: 1 gmina miejska, 2 wiejska, 3 miejsko-wiejska), jak w static/mapa (scripts/build_admin_map.py).
export const LEVELS = [2, 4, 7];

/** Gmina pola (WWPPGGT) z identyfikatora działki ULDK, np. 060910_2.0011.580/2 → 0609102; bez działki null.
 *  Działka z raportu, a gdy raport jeszcze się liczy, z danych pola (`input.parcel_id`). */
export function fieldTeryt(field) {
  const match = /^(\d{4})(\d{2})_(\d)\./.exec(field.report?.parcel?.id ?? field.input?.parcel_id ?? '');
  if (!match) return null;
  const [, county, commune, kind] = match;
  // dzielnice Warszawy i delegatury dużych miast (8, 9) leżą w gminie miejskiej WWPP01; miasto i obszar wiejski
  // gminy miejsko-wiejskiej (4, 5) to w Państwowym Rejestrze Granic jedna gmina typu 3
  if (kind === '8' || kind === '9') return `${county}011`;
  return county + commune + (kind === '4' || kind === '5' ? '3' : kind);
}

/**
 * Rola jednostki `unit` w widoku jednostki `code`:
 * - 'active': jednostka podrzędna widoku (zielona z liczbą pól albo szara bez pól);
 * - 'self': wybrana gmina (ostatni poziom, na niej rysujemy pola);
 * - 'context': sąsiedzi widoku i jego jednostek nadrzędnych, przygaszone tło;
 * - null: niewidoczna (np. gminy innych powiatów albo województwo, w które weszliśmy).
 */
export function unitRole(unit, code) {
  const depth = LEVELS.indexOf(code.length) + 1;   // '' → 0, WW → 1, WWPP → 2, WWPPGGT → 3
  const level = LEVELS.indexOf(unit.length);
  if (level === depth) return unit.startsWith(code) ? 'active' : null;
  if (unit === code) return depth === 3 ? 'self' : null;
  const parent = unit.slice(0, LEVELS[level - 1] ?? 0);
  return level < depth && code.startsWith(parent) && !code.startsWith(unit) ? 'context' : null;
}


// Wygląd jednostki w roli: wypełnienie i obrys [r, g, b, a] (paleta brand/neutral z styles/app.css), obrys w px
// i krycie plakietki z liczbą pól. W przejściu między poziomami każda jednostka płynnie miesza stary wygląd z nowym.
const LOOK = {
  filled: { fill: [141, 197, 159, 1], stroke: [255, 255, 255, 1], width: 1.5, badge: 1 },      // brand-300
  hover: { fill: [94, 166, 118, 1], stroke: [255, 255, 255, 1], width: 1.5, badge: 1 },        // brand-400
  empty: { fill: [219, 219, 212, 1], stroke: [255, 255, 255, 1], width: 1.25, badge: 0 },
  context: { fill: [236, 234, 227, 0], stroke: [214, 214, 207, .9], width: 1, badge: 0 },     // sam cienki kontur, bez tła
  self: { fill: [141, 197, 159, .08], stroke: [37, 92, 59, 1], width: 2.5, badge: 0 },          // obrys brand-700
};
const Z = { context: 0, active: 1, self: 2 };
const hidden = (look) => ({ ...look, fill: [...look.fill.slice(0, 3), 0], stroke: [...look.stroke.slice(0, 3), 0], badge: 0 });

export const lerp = (a, b, t) => a + (b - a) * t;

/** Wygląd jednostki `kod` (z `count` polami) w widoku jednostki `code`; null, gdy w tym widoku jej nie widać. */
export function lookOf(kod, count, code, hover) {
  const role = unitRole(kod, code);
  if (role !== 'active') return role && LOOK[role];
  return !count ? LOOK.empty : kod === hover ? LOOK.hover : LOOK.filled;
}

/**
 * Wygląd jednostki w chwili `t` [0–1] przejścia z widoku `from` do `to`: kolory, grubość obrysu, krycie plakietki
 * i warstwa. Jednostka, która pojawia się albo znika, przenika z przezroczystości. Niewidoczna w obu widokach: null.
 */
export function blendLook(kod, count, { from, to, t, hover }) {
  const a = lookOf(kod, count, from, hover), b = lookOf(kod, count, to, hover);
  if (!a && !b) return null;
  const start = a ?? hidden(b), end = b ?? hidden(a);
  return {
    zIndex: Z[unitRole(kod, to)] ?? Z[unitRole(kod, from)] ?? 0,
    fill: start.fill.map((v, i) => lerp(v, end.fill[i], t)),
    stroke: start.stroke.map((v, i) => lerp(v, end.stroke[i], t)),
    width: lerp(start.width, end.width, t),
    badge: lerp(start.badge, end.badge, t),
  };
}

/** Nazwa jednostki do zdania: województwo z przedrostkiem, powiat i gmina tak, jak w rejestrze. */
export const unitName = (unit) => (unit.kod.length === 2 ? `województwo ${unit.nazwa}` : unit.nazwa);
