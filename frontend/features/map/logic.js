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

