// Karuzela prognozy pogody: które dni widać i jak je podpisać. Bez Reacta.
import { dayMonth } from '../../shared/format/date.js';
import { number } from '../../shared/format/number.js';

/** Ile dni prognozy mieści się w jednym rzędzie. */
export const VISIBLE_DAYS = 7;
/** Ile dni prognozy pobieramy (najdłuższa prognoza Open-Meteo). */
export const FORECAST_DAYS = 16;
/** Opad, od którego dzień jest wyróżniony jako mokry. */
export const WET_DAY_MM = 5;
// od tylu milimetrów w wąskiej kolumnie opad bez części dziesiętnej, żeby liczby sąsiednich dni się nie zlewały
const ROUND_RAIN_FROM_MM = 10;

/** Punkty zatrzymania karuzeli: pełne 7-dniowe okna bez pustych dziur na końcu (dla 16 dni: 0, 7, 9). */
export function forecastStops(total, visible = VISIBLE_DAYS) {
  if (total <= visible) return [0];
  const max = total - visible;
  const stops = [];
  for (let i = 0; i < max; i += visible) stops.push(i);
  stops.push(max);
  return stops;
}

/** Opad dnia; w dużym widoku zawsze z jednym miejscem po przecinku. */
export const rainText = (mm, big) => `${number(mm, big || mm < ROUND_RAIN_FROM_MM ? 1 : 0)} mm`;

/** Zakres widocznych dni, np. „dziś – 28.11”; bez dni null. */
export function rangeLabel(first, last, todayIso) {
  if (!first || !last) return null;
  return `${first.date === todayIso ? 'dziś' : dayMonth(first.date)} – ${dayMonth(last.date)}`;
}
