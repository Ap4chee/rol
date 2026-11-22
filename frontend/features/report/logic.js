// Czysta logika zakładek raportu: grupy działań, wybór faktów do pokazania, serie do kart liczb i historia sezonów.
// Bez Reacta; komponenty obok tylko to rysują.
import { dateText, daysBetween, MONTHS } from '../../shared/format/date.js';
import { number } from '../../shared/format/number.js';
import { plural } from '../../shared/format/plural.js';
import { actionGroupImage } from '../../shared/assets.js';
import { WATER } from '../../shared/ui/colors.js';
import { statusTone } from '../fields/logic.js';

/** Grupy działań w kolejności narzuconej przez zadanie: najpierw retencja, potem agrotechnika, na końcu nawadnianie. */
export const GROUPS = [
  { key: 'retention', title: 'Zatrzymaj wodę na polu' },
  { key: 'agrotechnical', title: 'Zabiegi agrotechniczne' },
  { key: 'irrigation', title: 'Nawadnianie' },
];

/** Działania jednej grupy: z raportu, a za nimi z analizy terenu (doczytywanej osobno). */
export function groupActions(recommendations, terrainActions, category) {
  return [...(recommendations?.[category] ?? []), ...terrainActions.filter((item) => item.category === category)];
}

/** Liczba działań we wszystkich grupach (licznik na zakładce „Rekomendacje”). */
export const actionCount = (recommendations, terrainActions) =>
  GROUPS.reduce((count, group) => count + groupActions(recommendations, terrainActions, group.key).length, 0);

/** Oględziny pola z raportu i z terenu, bez powtórzeń po kluczu (późniejszy wpis wygrywa, kolejność zostaje). */
export function fieldChecks(recommendations, terrainActions) {
  return [...new Map([
    ...(recommendations.field_checks ?? []), ...terrainActions.filter((item) => item.category === 'field_check'),
  ].map((item) => [item.key, item])).values()];
}

// zdjęcia zabiegów (static/design) tylko tam, gdzie zdjęcie jednoznacznie pokazuje działanie; reszta ma ilustrację grupy
const ACTION_PHOTOS = { residue_cover: 'mulcz', cover_crop: 'miedzyplon', organic_matter: 'gleba',
  buffer_strip_watercourse: 'zadrzewienia', buffer_strip_flow_path: 'zadrzewienia', protect_depression: 'zaglebienie' };

/** Adres obrazka działania i czy to zdjęcie (kadrowane), czy ilustracja grupy (cała, na tle). */
export function actionArt(action, group) {
  const photo = ACTION_PHOTOS[action];
  return { photo: Boolean(photo), src: photo ? `/design/${photo}.jpg` : actionGroupImage(group) };
}

// shortcut: zdanie kończy się na [.!?] przed wielką literą („ok. 56 dni” zostaje w środku); krótki powód z backendu byłby pewniejszy
const SENTENCE_END = /(?<=[.!?])\s+(?=[A-ZĄĆĘŁŃÓŚŹŻ])/;

/** Pierwsze zdanie uzasadnienia, którego nie pokazał już wyższy wiersz (kilka działań bywa skutkiem tego samego faktu).
 *  `shown` to zbiór zdań już pokazanych na liście; funkcja go uzupełnia. */
export function pickFact(why, shown) {
  const sentences = (why ?? '').split(SENTENCE_END).filter(Boolean);
  const fact = sentences.find((sentence) => !shown.has(sentence)) ?? sentences[0];
  shown.add(fact);
  return { fact, rest: sentences.filter((sentence) => sentence !== fact) };
}

/** Czy nawadniać teraz: wskazane, gdy raport ma działanie z grupy nawadniania; inaczej powód z `irrigation_note`. */
export function irrigationVerdict(recommendations, items, water) {
  if (recommendations?.status !== 'ok') return { label: 'Brak oceny', tone: 'unknown',
    detail: recommendations?.reason ?? 'Brakuje danych do zaleceń.' };
  if (!items.length) return { label: 'Teraz niepotrzebne', tone: 'ok', detail: recommendations.irrigation_note };
  const evidence = items[0].evidence ?? {};
  return { label: 'Teraz wskazane', tone: statusTone(water),
    detail: Number.isFinite(evidence.to_threshold_mm)
      ? `Do progu stresu brakuje ok. ${number(evidence.to_threshold_mm)} mm, do pełnego zapasu ${number(evidence.full_refill_mm)} mm `
        + '(1 mm = 10 m³ na hektar). Najpierw działania zatrzymujące wodę, nawadnianie jako uzupełnienie.'
      : items[0].title };
}

const dosesWord = (n) => plural(n, 'dawka', 'dawki', 'dawek');
const whole = (v) => number(v);

/** Dwie karty jak w „Zapasie wody”: typowy sezon ze słupkami miesięcy i bieżący sezon (poza sezonem: ile sezonów wymagało wody). */
export function needCards(need) {
  const typical = {
    label: 'Nawadnianie w typowym sezonie', value: need.typical_mm ?? null, unit: 'mm', format: whole, delta: false,
    color: WATER, caption: need.dry_mm != null ? `w suchym roku ${number(need.dry_mm)} mm` : null,
    bars: need.monthly?.length ? need.monthly.map((m) => ({ label: MONTHS[m.month - 1], value: m.mm })) : undefined,
  };
  if (need.so_far_mm != null) return [typical, {
    label: 'Nawadnianie w tym sezonie', value: need.so_far_mm, unit: 'mm', format: whole, delta: false, color: WATER,
    caption: `do dziś, ${need.so_far_events} ${dosesWord(need.so_far_events)}`,
    progress: need.typical_mm ? Math.min(1, need.so_far_mm / need.typical_mm) : undefined,
  }];
  const needed = need.seasons_compared - need.seasons_without;
  return [typical, {
    label: 'Sezony z potrzebą nawadniania', value: need.seasons_compared ? needed : null, unit: `z ${need.seasons_compared}`,
    format: whole, delta: false, color: WATER, caption: 'ostatnie pełne sezony',
    progress: need.seasons_compared ? needed / need.seasons_compared : undefined,
  }];
}

/**
 * Sezony z długim niedoborem w tej samej definicji co rekomendacje (serwer: `long_stress_days`).
 * Raporty zapisane przed tą zmianą mają tylko „co najmniej jeden dzień”, więc dla nich zostaje stara definicja.
 */
export function stressSeasons(history) {
  const long = history?.long_stress_days;
  return long && Number.isFinite(history.seasons_with_long_stress)
    ? { count: history.seasons_with_long_stress, long, isStressed: (season) => season.stress_days_critical >= long }
    : { count: history?.seasons_with_stress, long: null, isStressed: (season) => season.stressed };
}

/** Zdjęcia satelitarne przyjęte do analizy, od najstarszego. */
export function satelliteMeasurements(satellite) {
  return (satellite?.observations ?? [])
    .filter((point) => point.accepted && point.date && Number.isFinite(point.ndvi))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Miesiące okresu krytycznego uprawy (0 = styczeń), także przez granicę roku; najwyżej 12. */
export function seasonMonths(crop) {
  if (!crop.critical_from || !crop.critical_to) return [];
  const start = new Date(crop.critical_from + 'T12:00:00Z');
  const end = new Date(crop.critical_to + 'T12:00:00Z');
  if (!(start <= end)) return [];
  start.setUTCDate(1);
  const months = [];
  for (let i = 0; i < 12 && start <= end; i += 1) {
    months.push(start.getUTCMonth());
    start.setUTCMonth(start.getUTCMonth() + 1);
  }
  return months;
}

/** Suma narastająca: wykres w karcie liczby kończy się dokładnie na tej liczbie. */
export function runningTotal(values) {
  let sum = 0;
  return values.map((value) => (sum += value));
}

/** Nagłówek oceny z dwóch zdań (np. poza sezonem: „Uprawa nie jest w okresie wzrostu. Zapas…”): pierwsze jako kontekst
 *  drobnym drukiem, drugie dużym. Jedno zdanie zostaje w całości. */
export function splitHeadline(headline) {
  const cut = headline.indexOf('. ');
  return cut > 0 && cut < headline.length - 2 ? [headline.slice(0, cut + 1), headline.slice(cut + 2)] : [null, headline];
}

const RAIN_WINDOW_DAYS = 30;

/**
 * Dane do kart liczb pod wykresem zapasu. Wykresy w kartach to sumy narastające z dziennych wartości bilansu z tego
 * samego okna co liczba (oba kończą się na ostatnim dniu z danymi); seria jest tylko wtedy, gdy każdy dzień ma dane.
 */
export function waterFacts(report) {
  const water = report.water_status;
  const series = water.series ?? [];
  const rain = report.causes.windows?.find((w) => w.days === RAIN_WINDOW_DAYS);
  const climat = water.climatic_water_balance;
  const history = report.history;

  const rainDays = rain && series.length >= RAIN_WINDOW_DAYS ? series.slice(-RAIN_WINDOW_DAYS) : [];
  const rainSeries = rainDays.length === RAIN_WINDOW_DAYS && rainDays.every((d) => Number.isFinite(d.rain_mm));
  const balanceDays = climat?.days > 1 && series.length >= climat.days ? series.slice(-climat.days) : [];
  const balanceSeries = balanceDays.length > 1 && balanceDays.every((d) => Number.isFinite(d.rain_mm) && Number.isFinite(d.et0_mm));

  // odcinki: jeden na pełny sezon; tylko gdy zgadzają się z liczbą (inaczej sam pasek udziału)
  const seasons = (history.seasons ?? []).filter((s) => s.complete !== false);
  const stress = stressSeasons(history);
  const segments = history.seasons_total > 0 && seasons.length === history.seasons_total
    && seasons.filter(stress.isStressed).length === stress.count;

  return {
    rain, climat, history, stress, seasons, segments,
    rainDays: rainSeries ? rainDays : null,
    rainTotals: rainSeries ? runningTotal(rainDays.map((d) => d.rain_mm)) : undefined,
    balanceDays: balanceSeries ? balanceDays : null,
    balanceTotals: balanceSeries ? runningTotal(balanceDays.map((d) => d.rain_mm - d.et0_mm)) : undefined,
  };
}

export function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** „dzień” albo „dni” (po polsku 2, 5 i 22 to zawsze „dni”). */
export const daysWord = (n) => plural(n, 'dzień', 'dni', 'dni');

/** Typowy (mediana) i najgorszy sezon spośród pełnych sezonów; bez pełnych sezonów null. */
export function seasonStats(seasons) {
  const past = seasons.filter((season) => season.complete);
  const typical = past.length ? Math.round(median(past.map((season) => season.stress_days_critical))) : null;
  const worst = past.reduce((a, s) => (s.stress_days_critical > (a?.stress_days_critical ?? 0) ? s : a), null);
  return { typical, worst };
}

/** Zdanie pod porównaniem z tym samym dniem w poprzednich latach (`drier` z `n` lat było bardziej sucho). */
export function sameDayLead(drier, n, dayMonth) {
  if (drier === 0) return `W żadnym z ${n} poprzednich lat ${dayMonth} gleba nie miała mniej wody.`;
  if (drier === n) return `W każdym z ${n} poprzednich lat ${dayMonth} gleba miała mniej wody.`;
  if (drier <= n / 3) return 'Suszej niż zwykle o tej porze roku.';
  return drier >= (2 * n) / 3 ? 'Wilgotniej niż zwykle o tej porze roku.' : 'Typowo jak na tę porę roku.';
}

/** Prognoza do wykresu zapasu: dni bilansu na prognozie pogody i dni modelu ML (`ml.points`) złączone po dacie. */
export function futurePoints(forecast, mlPoints) {
  const byDate = new Map(forecast.map((p) => [p.date, { ...p, kind: 'forecast' }]));
  for (const p of mlPoints) {
    byDate.set(p.date, { ...(byDate.get(p.date) ?? { date: p.date, kind: 'forecast' }),
      ml_pct: p.available_pct, ml_low: p.low_pct, ml_high: p.high_pct });
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Fakty w nagłówku raportu: uprawa, powierzchnia, działka i „stan na”. „Stan na” to ostatni dzień z pogodą w bilansie,
 * a nie data analizy: NASA POWER bywa kilka dni do tyłu. Dzień opóźnienia to norma przy analizie na dziś (doba jeszcze
 * trwa); dłuższy brak mówimy wprost.
 */
export function headerFacts(report) {
  const parcel = report.parcel;
  // numer i obręb zamiast identyfikatora EGiB (pełny identyfikator jest w zakładce Źródła)
  const parcelText = parcel?.number ? [`działka ${parcel.number}`, parcel.region && `obręb ${parcel.region}`].filter(Boolean).join(', ')
    : parcel?.id ?? 'wskazany punkt';
  const stateDay = report.water_status.last_data_day ?? report.analysis_date;
  const lag = daysBetween(stateDay, report.analysis_date);
  return [
    { text: report.crop.name },
    parcel?.area_ha != null && { text: `${number(parcel.area_ha, 2)} ha` },
    { text: parcelText, wrap: true },
    { text: `stan na ${dateText(stateDay)}` },
    lag > 1 && { text: `dane pogody są o ${lag} dni wcześniejsze niż data analizy (${dateText(report.analysis_date)})`, warn: true, wrap: true },
  ].filter(Boolean);
}
