import { StatusBadge, TONE } from '@/shared/ui/status';
import { statusTone } from './logic.js';

const LABEL = { none: 'Brak suszy', watch: 'Obserwuj', moderate: 'Umiarkowana susza', severe: 'Silna susza' };
const OFF_SEASON = { none: 'Wysoki zapas', watch: 'Niższy zapas', moderate: 'Niski zapas', severe: 'Bardzo niski zapas' };

/** Kolor znaku stanu (CSS), np. linia wykresu, pasek. */
export function statusFill(water) {
  return TONE[statusTone(water)].fill;
}

/** Kolor tekstu w kolorze stanu (ciemniejszy, czytelny na bieli). */
export function statusInk(water) {
  return TONE[statusTone(water)].ink;
}

/** Plakietka stanu wody (poza sezonem mówi o zapasie, nie o suszy). */
export function Status({ water, size, className }) {
  const known = water?.status === 'ok' && LABEL[water.class_key];
  const label = known ? (water.in_season === false ? OFF_SEASON[water.class_key] : LABEL[water.class_key]) : 'Brak oceny';
  return <StatusBadge tone={statusTone(water)} size={size} className={className} title={water?.class_label ?? undefined}>{label}</StatusBadge>;
}
