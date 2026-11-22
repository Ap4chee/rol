import assert from 'node:assert/strict';
import test from 'node:test';
import { bucketsLead, distanceText, leadSentence, waterBuckets } from './logic.js';

const field = (status, key) => ({ report: { water_status: { status, class_key: key } } });

test('pola liczone w stanach od najpilniejszego, bez oceny osobno', () => {
  const buckets = waterBuckets([field('ok', 'severe'), field('ok', 'none'), field('ok', 'none'), field('no_data', 'severe')]);
  assert.deepEqual(buckets.map((b) => [b.key, b.count]),
    [['severe', 1], ['moderate', 0], ['watch', 0], ['none', 2], ['unknown', 1]]);
  assert.equal(waterBuckets([field('ok', 'watch')]).length, 4);
});

test('zdanie o stanie pól odmienia liczby i mówi wprost o braku oceny', () => {
  assert.equal(leadSentence(1, 1, 0), '1 z 1 pola potrzebuje teraz uwagi.');
  assert.equal(leadSentence(5, 3, 0), '3 z 5 pól potrzebują teraz uwagi.');
  assert.equal(leadSentence(14, 12, 0), '12 z 14 pól potrzebuje teraz uwagi.');
  assert.equal(leadSentence(2, 0, 2), 'Żadne z 2 pól nie ma oceny wody.');
  assert.equal(leadSentence(3, 0, 2), 'Żadne z 1 ocenionego pola nie ma teraz niedoboru wody.');
  assert.equal(leadSentence(3, 0, 1), 'Żadne z 2 ocenionych pól nie ma teraz niedoboru wody.');
  assert.equal(leadSentence(4, 0, 0), 'Żadne z 4 pól nie ma teraz niedoboru wody.');
  assert.equal(bucketsLead(waterBuckets([field('ok', 'moderate'), field('ok', 'none')])), '1 z 2 pól potrzebuje teraz uwagi.');
});

test('odległość do cieku w metrach albo kilometrach', () => {
  assert.equal(distanceText(420), '420 m');
  assert.equal(distanceText(1530), '1,5 km');
});
