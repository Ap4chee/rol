// Adresy widoków w części po „#”: pulpit (pusty), pole z zakładką, podgląd raportu z linku, mapa pól i plan prac.
// Czyste funkcje; nasłuch zmian adresu i przejścia są w useHashRoute.js.

export const TABS = ['podsumowanie', 'rekomendacje', 'prace', 'gleba', 'pogoda', 'teren', 'historia', 'zrodla'];

/** Kody TERYT jednostek na mapie: województwo WW, powiat WWPP, gmina WWPPGGT. */
const MAP_CODE = /^(\d{2}|\d{4}|\d{7})$/;

export const DASHBOARD_HREF = '#';
export const PLAN_HREF = '#plan';
export const PREVIEW_HREF = '#podglad';
/** Dawny adres formularza; dziś tylko otwiera okno dodawania pola. */
export const LEGACY_ADD_HREF = '#dodaj';

export function fieldHref(id) {
  return '#pole/' + encodeURIComponent(id);
}

/** Zakładka pola albo podglądu raportu z linku (`id` = 'preview'). */
export function fieldTabHref(id, tab) {
  return id === 'preview' ? `#podglad/${tab}` : `${fieldHref(id)}/${tab}`;
}

/** Poziom mapy pól: cała Polska bez kodu, inaczej jednostka po kodzie TERYT. */
export const mapHref = (code) => (code ? `#mapa/${code}` : '#mapa');

/** Pole z adresu: `#pole/<id>` albo `#pole/<id>/<zakładka>` (id zakodowane, więc bez „/”), `#podglad[/zakładka]`. */
export function routeTab(hash) {
  const [head, encoded, tab] = hash.replace(/^#/, '').split('/');
  const known = TABS.includes(tab) ? tab : TABS[0];
  if (head === 'podglad') return { id: 'preview', tab: TABS.includes(encoded) ? encoded : TABS[0] };
  if (head !== 'pole' || !encoded) return { id: null, tab: known };
  try { return { id: decodeURIComponent(encoded), tab: known }; } catch { return { id: null, tab: known }; }
}

/** Kod jednostki z adresu `#mapa/<kod>` ('' to cała Polska); null, gdy adres nie jest mapą pól. Nieznany kod to Polska. */
export function mapCode(hash) {
  const [head, code = ''] = hash.replace(/^#/, '').split('/');
  if (head !== 'mapa') return null;
  return MAP_CODE.test(code) ? code : '';
}

/** Strona do pokazania; pole wygrywa z resztą, gdy adres wskazuje istniejące pole albo podgląd. */
export function pageOf(hash, hasField) {
  if (hasField) return 'field';
  if (mapCode(hash) !== null) return 'map';
  return hash === PLAN_HREF ? 'plan' : 'dashboard';
}
