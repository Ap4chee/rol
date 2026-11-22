// Pulpit jako dane: ile pól jest w jakim stanie i zdanie, które to podsumowuje. Bez Reacta.
import { number } from '../../shared/format/number.js';
import { plural } from '../../shared/format/plural.js';

/** Stany wody w kolejności pilności: klucz oceny z serwera, ton koloru, podpis pod liczbą. */
const BUCKETS = [
  ['severe', 'severe', 'silny niedobór'], ['moderate', 'moderate', 'umiarkowany niedobór'],
  ['watch', 'watch', 'do obserwacji'], ['none', 'ok', 'bez niedoboru'],
];

/** Liczba pól w każdym stanie; pola bez oceny osobno na końcu, tylko gdy są. */
export function waterBuckets(fields) {
  const count = (key) => fields.filter(({ report: { water_status: water } }) => water.status === 'ok' && water.class_key === key).length;
  const buckets = BUCKETS.map(([key, tone, label]) => ({ key, tone, label, count: count(key) }));
  const unknown = fields.length - buckets.reduce((sum, bucket) => sum + bucket.count, 0);
  if (unknown) buckets.push({ key: 'unknown', tone: 'unknown', label: 'bez oceny', count: unknown });
  return buckets;
}

const fieldsOf = (n) => `z ${n} ${plural(n, 'pola', 'pól', 'pól')}`;
// 2–4 pola (bez 12–14) „potrzebują”; 1 pole i 5+ pól „potrzebuje”
const needs = (n) => plural(n, 'potrzebuje', 'potrzebują', 'potrzebuje');

/** Zdanie nad paskiem stanów: ile pól pilnie potrzebuje uwagi, a bez takich pól, że żadne nie ma niedoboru. */
export function leadSentence(total, urgent, unknown) {
  if (urgent) return `${urgent} ${fieldsOf(total)} ${needs(urgent)} teraz uwagi.`;
  // pola bez oceny nie wchodzą do „żadne nie ma niedoboru” (brak danych mówimy wprost)
  const assessed = total - unknown;
  if (!assessed) return `Żadne ${fieldsOf(total)} nie ma oceny wody.`;
  if (unknown) return `Żadne ${assessed === 1 ? 'z 1 ocenionego pola' : `z ${assessed} ocenionych pól`} nie ma teraz niedoboru wody.`;
  return `Żadne ${fieldsOf(total)} nie ma teraz niedoboru wody.`;
}

/** Zdanie dla gotowych kubełków stanów: pilne to silny i umiarkowany niedobór. */
export function bucketsLead(buckets) {
  const of = (key) => buckets.find((bucket) => bucket.key === key)?.count ?? 0;
  const total = buckets.reduce((sum, bucket) => sum + bucket.count, 0);
  return leadSentence(total, of('severe') + of('moderate'), of('unknown'));
}

/** Odległość do cieku: do kilometra w metrach, dalej w kilometrach z jednym miejscem. */
export const distanceText = (m) => (m < 1000 ? `${number(m)} m` : `${number(m / 1000, 1)} km`);
