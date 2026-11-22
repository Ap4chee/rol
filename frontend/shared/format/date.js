// Daty w raporcie to napisy ISO (RRRR-MM-DD) w czasie polskim. Tu tylko ich odczyt i zapis do tekstu.

export const MONTHS = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'];

const MS_PER_DAY = 86_400_000;
// Rok wstecz dla najstarszej daty analizy: tyle sięgają dane pogodowe używane w raporcie.
const OLDEST_YEARS_BACK = 10;

/** Dzisiejsza data w Polsce jako RRRR-MM-DD (sv-SE formatuje właśnie tak). */
export function today() {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Warsaw' }).format(new Date());
}

/** Najstarsza dozwolona data analizy; 29 lutego przechodzi na 28, gdy rok docelowy nie jest przestępny. */
export function oldestDate(date = today()) {
  const year = Number(date.slice(0, 4)) - OLDEST_YEARS_BACK;
  const monthDay = date.slice(4);
  const calendarDate = new Date(`${year}${monthDay}T12:00:00Z`);
  return calendarDate.getUTCMonth() === 2 && monthDay === '-02-29' ? `${year}-02-28` : year + monthDay;
}

/** „15.07.2026” z daty ISO (także z datą i godziną); „—”, gdy daty nie ma. */
export const dateText = (iso) => iso ? iso.slice(0, 10).split('-').reverse().join('.') : '—';

/** „15.07” z daty ISO. */
export const dayMonth = (iso) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;

/** Liczba dni od `from` do `to` (daty ISO); 0, gdy brakuje którejś z nich. */
export function daysBetween(from, to) {
  if (!from || !to) return 0;
  return Math.round((Date.parse(to.slice(0, 10)) - Date.parse(from.slice(0, 10))) / MS_PER_DAY);
}

/** Data ISO przesunięta o `days` dni kalendarzowych. */
export const addDays = (iso, days) => new Date(Date.parse(iso + 'T12:00:00Z') + days * MS_PER_DAY).toISOString().slice(0, 10);

// Południe UTC to w Polsce zawsze ten sam dzień kalendarzowy (13:00 albo 14:00), więc strefa nie przesuwa daty.
const weekdayFormat = new Intl.DateTimeFormat('pl-PL', { weekday: 'short', timeZone: 'Europe/Warsaw' });

/** Skrót dnia tygodnia bez kropki („pon”, „wt”), a dla dzisiejszej daty „dziś”. */
export const dayName = (iso, todayIso) => (iso === todayIso ? 'dziś' : weekdayFormat.format(new Date(iso + 'T12:00:00Z')).replace('.', ''));
