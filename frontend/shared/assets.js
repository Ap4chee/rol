// Ilustracje z static/design i to, co je łączy z danymi raportu. Obrazki serwuje FastAPI pod /design.

// Ilustracje 3D (makiety pola z przekrojem gleby) mają przezroczyste tło bez cienia, więc cień dokłada CSS.
export const ART_SHADOW = 'drop-shadow-[0_10px_14px_rgba(0,0,0,0.12)]';

const CROP_IMAGES = { maize: 'kukurydza', winter_wheat: 'pszenica', spring_barley: 'jeczmien', winter_rapeseed: 'rzepak',
  grassland: 'laka', potato: 'ziemniaki', sugar_beet: 'burak' };

/** Ilustracja uprawy; uprawa bez ilustracji daje undefined (wtedy pokazujemy ikonę kiełka). */
export const cropImage = (key) => (CROP_IMAGES[key] ? `/design/${CROP_IMAGES[key]}.png` : undefined);

const BUCKET_IMAGES = { severe: 'silny', moderate: 'umiarkowany', watch: 'obserwacja', none: 'ok', unknown: 'brak' };

/** Ilustracja stanu wody (klasa oceny albo 'unknown'). */
export const stateImage = (classKey) => `/design/stan-${BUCKET_IMAGES[classKey] ?? 'brak'}.png`;

const ACTION_IMAGES = { retention: 'retencja', agrotechnical: 'agrotechnika', irrigation: 'nawadnianie', field_check: 'ogledziny' };

/** Ilustracja grupy działań (retencja, agrotechnika, nawadnianie, oględziny); nieznana grupa daje undefined. */
export const actionGroupImage = (group) => (ACTION_IMAGES[group] ? `/design/akcja-${ACTION_IMAGES[group]}.png` : undefined);

/** Kod pogody WMO → [ilustracja z /design/pogoda-*.png albo null, opis]. */
export function weatherIcon(code) {
  if (code === 0) return ['slonce', 'Bezchmurnie'];
  if (code === 1 || code === 2) return ['przejasnienia', 'Częściowe zachmurzenie'];
  if (code === 3) return ['pochmurno', 'Zachmurzenie'];
  if (code === 45 || code === 48) return ['mgla', 'Mgła'];
  if ([71, 73, 75, 77, 85, 86].includes(code)) return ['snieg', 'Śnieg'];
  if (code >= 95) return ['burza', 'Burza'];
  if (Number.isFinite(code) && code >= 51) return ['deszcz', 'Opad'];
  return [null, 'Brak danych'];
}
