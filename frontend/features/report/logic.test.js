import assert from 'node:assert/strict';
import { test } from 'node:test';
import { actionArt, actionCount, fieldChecks, futurePoints, groupActions, headerFacts, irrigationVerdict, median, needCards, pickFact,
  sameDayLead, satelliteMeasurements, seasonMonths, seasonStats, splitHeadline, stressSeasons, waterFacts } from './logic.js';

test('zdjęcia satelitarne: tylko przyjęte, od najstarszego, zero to też pomiar', () => {
  assert.deepEqual(satelliteMeasurements({ observations: [
    { accepted: true, date: '2025-09-10', ndvi: 0 },
    { accepted: false, date: '2025-09-01', ndvi: .81 },
    { accepted: true, date: '2025-08-10', ndvi: -.05 },
  ] }).map((s) => s.ndvi), [-.05, 0]);
});

test('okres krytyczny przez granicę roku', () => {
  assert.deepEqual(seasonMonths({ critical_from: '2025-11-12', critical_to: '2026-02-01' }), [10, 11, 0, 1]);
  assert.deepEqual(seasonMonths({}), []);
});

test('jedna definicja sezonów z niedoborem, także dla starych raportów', () => {
  const seasons = [{ stressed: true, stress_days_critical: 3 }, { stressed: true, stress_days_critical: 20 }, { stressed: false, stress_days_critical: 0 }];
  const now = stressSeasons({ seasons_with_stress: 2, seasons_with_long_stress: 1, long_stress_days: 14 });
  assert.equal(now.count, 1);
  assert.deepEqual(seasons.map(now.isStressed), [false, true, false]);
  const saved = stressSeasons({ seasons_with_stress: 2 });   // raport zapisany przed zmianą
  assert.equal(saved.count, 2);
  assert.deepEqual(seasons.map(saved.isStressed), [true, true, false]);
});

test('działania z terenu dopisane do grup, oględziny bez powtórzeń', () => {
  const recommendations = { retention: [{ key: 'a' }], irrigation: [{ key: 'b' }], field_checks: [{ key: 'look', title: 'stare' }] };
  const terrain = [{ key: 'c', category: 'retention' }, { key: 'look', category: 'field_check', title: 'z terenu' }];
  assert.deepEqual(groupActions(recommendations, terrain, 'retention').map((a) => a.key), ['a', 'c']);
  assert.equal(actionCount(recommendations, terrain), 3);
  assert.deepEqual(fieldChecks(recommendations, terrain).map((a) => a.title), ['z terenu']);
});

test('obrazek działania: zdjęcie zabiegu albo ilustracja grupy', () => {
  assert.deepEqual(actionArt('cover_crop', 'agrotechnical'), { photo: true, src: '/design/miedzyplon.jpg' });
  assert.deepEqual(actionArt('drain_block', 'retention'), { photo: false, src: '/design/akcja-retencja.png' });
});

test('fakt pod tytułem: pierwsze niepokazane zdanie, skróty w środku zdania zostają', () => {
  const shown = new Set();
  const why = 'Brakuje ok. 56 mm wody. Gleba jest lekka.';
  assert.deepEqual(pickFact(why, shown), { fact: 'Brakuje ok. 56 mm wody.', rest: ['Gleba jest lekka.'] });
  assert.equal(pickFact(why, shown).fact, 'Gleba jest lekka.');
  assert.equal(pickFact('', new Set()).fact, undefined);
});

test('werdykt nawadniania: brak oceny, niepotrzebne i wskazane z liczbami', () => {
  assert.equal(irrigationVerdict({ status: 'no_data', reason: 'Brak gleby.' }, [], {}).detail, 'Brak gleby.');
  assert.deepEqual(irrigationVerdict({ status: 'ok', irrigation_note: 'Zapas wystarczy.' }, [], {}),
    { label: 'Teraz niepotrzebne', tone: 'ok', detail: 'Zapas wystarczy.' });
  const now = irrigationVerdict({ status: 'ok' }, [{ evidence: { to_threshold_mm: 12, full_refill_mm: 40 } }],
    { status: 'ok', class_key: 'severe' });
  assert.equal(now.tone, 'severe');
  assert.match(now.detail, /^Do progu stresu brakuje ok\. 12 mm, do pełnego zapasu 40 mm/);
});

test('karty potrzeby nawadniania w sezonie i poza nim', () => {
  const [typical, season] = needCards({ typical_mm: 100, dry_mm: 160, so_far_mm: 50, so_far_events: 2, monthly: [{ month: 7, mm: 30 }] });
  assert.equal(typical.caption, 'w suchym roku 160 mm');
  assert.deepEqual(typical.bars, [{ label: 'lip', value: 30 }]);
  assert.equal(season.caption, 'do dziś, 2 dawki');
  assert.equal(season.progress, 0.5);
  const [, off] = needCards({ typical_mm: null, seasons_compared: 10, seasons_without: 4 });
  assert.equal(off.value, 6);
  assert.equal(off.unit, 'z 10');
});

test('nagłówek oceny: zdanie kontekstu oddzielone od stwierdzenia', () => {
  assert.deepEqual(splitHeadline('Uprawa nie rośnie. Zapas jest niski.'), ['Uprawa nie rośnie.', 'Zapas jest niski.']);
  assert.deepEqual(splitHeadline('Silna susza'), [null, 'Silna susza']);
});

test('karty liczb: serie tylko z pełnych okien, sumy narastające kończą się na liczbie', () => {
  const day = (i) => ({ date: `2026-07-${String(i + 1).padStart(2, '0')}`, rain_mm: 1, et0_mm: 3 });
  const report = {
    water_status: { series: Array.from({ length: 30 }, (_, i) => day(i)), climatic_water_balance: { days: 10, balance_mm: -20 } },
    causes: { windows: [{ days: 30, rain_mm: 30 }] },
    history: { seasons_total: 2, seasons_with_stress: 1, seasons: [{ season: '2024', stressed: true }, { season: '2025', stressed: false }] },
  };
  const facts = waterFacts(report);
  assert.equal(facts.rainTotals.at(-1), 30);
  assert.equal(facts.balanceTotals.at(-1), -20);
  assert.equal(facts.segments, true);
  report.water_status.series[3].rain_mm = null;
  assert.equal(waterFacts(report).rainTotals, undefined);
});

test('historia sezonów: mediana, najgorszy sezon i zdanie porównania', () => {
  assert.equal(median([5, 1, 3]), 3);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  const seasons = [{ season: '2023', complete: true, stress_days_critical: 4 }, { season: '2024', complete: true, stress_days_critical: 30 },
    { season: '2025', complete: true, stress_days_critical: 7 }, { season: '2026', complete: false, stress_days_critical: 90 }];
  assert.deepEqual(seasonStats(seasons), { typical: 7, worst: seasons[1] });
  assert.deepEqual(seasonStats([]), { typical: null, worst: null });
  assert.equal(sameDayLead(0, 10, '15.07'), 'W żadnym z 10 poprzednich lat 15.07 gleba nie miała mniej wody.');
  assert.equal(sameDayLead(2, 10, '15.07'), 'Suszej niż zwykle o tej porze roku.');
  assert.equal(sameDayLead(5, 10, '15.07'), 'Typowo jak na tę porę roku.');
  assert.equal(sameDayLead(8, 10, '15.07'), 'Wilgotniej niż zwykle o tej porze roku.');
});

test('prognoza bilansu i modelu ML złączona po dacie', () => {
  const points = futurePoints([{ date: '2026-07-02', available_pct: 40 }],
    [{ date: '2026-07-01', available_pct: 50, low_pct: 45, high_pct: 55 }, { date: '2026-07-02', available_pct: 38, low_pct: 30, high_pct: 44 }]);
  assert.deepEqual(points.map((p) => [p.date, p.kind, p.ml_pct]), [['2026-07-01', 'forecast', 50], ['2026-07-02', 'forecast', 38]]);
  assert.equal(points[1].available_pct, 40);
});

test('nagłówek raportu mówi wprost o opóźnionej pogodzie', () => {
  const report = { crop: { name: 'Kukurydza' }, parcel: { number: '580/2', region: 'Niedrzwica', area_ha: 1.234 },
    analysis_date: '2026-07-15', water_status: { last_data_day: '2026-07-14' } };
  assert.deepEqual(headerFacts(report).map((f) => f.text),
    ['Kukurydza', '1,23 ha', 'działka 580/2, obręb Niedrzwica', 'stan na 14.07.2026']);
  const late = headerFacts({ ...report, parcel: null, water_status: { last_data_day: '2026-07-10' } });
  assert.equal(late[1].text, 'wskazany punkt');
  assert.equal(late.at(-1).warn, true);
  assert.match(late.at(-1).text, /o 5 dni wcześniejsze niż data analizy \(15\.07\.2026\)/);
});
