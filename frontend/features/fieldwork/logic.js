// Plan prac polowych: zapytanie do /api/fieldwork z raportu pola i opisy dni (bez Reacta, testowalne w node).
import { dayMonth, daysBetween } from '../../shared/format/date.js';

export const OPERATIONS = [
  { key: 'traffic', label: 'Wjazd i uprawa', image: 'wjazd' },
  { key: 'sowing', label: 'Siew', image: 'siew' },
  { key: 'spraying', label: 'Opryski', image: 'oprysk' },
  { key: 'fertilizing', label: 'Nawożenie', image: 'nawozenie' },
];

const TOP_CM = 10;   // wierzch gleby jak warstwa parowania w bilansie (FAO-56: Ze = 0,10 m)

/**
 * Zapytanie z raportu pola: położenie (EPSG:4326), uprawa i uziarnienie wierzchu 0–10 cm (średnia warstw SoilGrids
 * ważona grubością w tym przedziale). Bez położenia null. Bez gleby same współrzędne: serwer liczy glebę umowną i to mówi.
 */
export function fieldworkQuery(report) {
  const position = report.parcel?.centroid ?? report.request?.point;
  if (!position || !report.crop?.key) return null;
  const params = new URLSearchParams({ lat: position.lat, lon: position.lon, crop: report.crop.key });
  const top = (report.soil?.assumed ? [] : report.soil?.layers ?? [])
    .map((layer) => [layer, Math.min(layer.bottom_cm, TOP_CM) - Math.min(layer.top_cm, TOP_CM)])
    .filter(([, cm]) => cm > 0);
  const total = top.reduce((sum, [, cm]) => sum + cm, 0);
  for (const [param, key] of [['sand', 'sand_pct'], ['clay', 'clay_pct'], ['soc', 'soc_g_kg']]) {
    if (!total || !top.every(([layer]) => Number.isFinite(layer[key]))) continue;
    params.set(param, (top.reduce((sum, [layer, cm]) => sum + layer[key] * cm, 0) / total).toFixed(1));
  }
  return params.toString();
}

/** Najlepsze okno jako tekst, np. „24.11–26.11 (3 dni)”; bez okna null. */
export function windowText(window) {
  if (!window) return null;
  const days = daysBetween(window.date_from, window.date_to) + 1;
  return days === 1 ? dayMonth(window.date_from) : `${dayMonth(window.date_from)}–${dayMonth(window.date_to)} (${days} dni)`;
}

/** Dlaczego nie ma dobrego okna: najczęstszy powód z dni ocenionych źle (poza sezonem: powód sezonu). */
export function mainObstacle(days, op) {
  const rated = days.map((day) => day[op]).filter((rating) => rating.rating !== 'good');
  const pool = rated.some((r) => r.rating === 'avoid' || r.rating === 'caution')
    ? rated.filter((r) => r.rating === 'avoid' || r.rating === 'caution') : rated;
  const counts = new Map();
  // powód bywa sumą kilku („a; b”), więc liczymy każdy osobno
  for (const reason of pool.flatMap((r) => r.reason.split('; '))) counts.set(reason, (counts.get(reason) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}
