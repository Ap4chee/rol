// Pole rolnika jako dane: zapis na serwer, odczyt z dawnej pamięci przeglądarki, stan wody i kolejność pilności.
// Tylko czyste funkcje; widoki pola są w komponentach obok, a zapytania w api/.
import { today } from '../../shared/format/date.js';
import { testParcel } from './testParcel.js';

/** Klucz, pod którym dawna wersja trzymała pola w przeglądarce (dziś tylko do przeniesienia na serwer). */
export const STORAGE_KEY = 'kowr.saved-fields.v1';

// Stan oceny wody (serwer: water_status.class_key) → ton plakietek i wykresów (kolory w styles/app.css).
const TONES = { none: 'ok', watch: 'watch', moderate: 'moderate', severe: 'severe' };

/** Ton stanu: 'ok' | 'watch' | 'moderate' | 'severe' | 'unknown'. */
export function statusTone(water) {
  return water?.status === 'ok' ? TONES[water.class_key] ?? 'unknown' : 'unknown';
}

/** Zapas wody jako procent pojemności wodnej strefy korzeni [0–100]; null, gdy nie ma z czego liczyć. */
export function waterPercent(result) {
  if (!result || !Number.isFinite(result.available_mm) || !(result.taw_mm > 0)) return null;
  return Math.min(100, Math.max(0, 100 * result.available_mm / result.taw_mm));
}

/** Pole z gotowego raportu (link do raportu, pola zapisane dawniej w przeglądarce). */
export function fieldFromReport(report, name = '') {
  const point = report.request.point;
  const id = report.parcel?.id ?? report.request.parcel_id ?? `punkt:${point.lat},${point.lon}`;
  const title = name.trim() || (report.parcel?.number ? `Działka ${report.parcel.number}` : point ? 'Wskazany punkt' : id);
  return { id, name: title, report };
}

/** Pola z dawnej pamięci przeglądarki; wpisy bez pełnego raportu są pomijane, uszkodzony zapis to pusta lista. */
export function readFields(storage) {
  try {
    const fields = JSON.parse(storage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(fields) ? fields.filter((field) =>
      typeof field?.id === 'string' && typeof field.name === 'string' &&
      field.report?.request && field.report?.crop && field.report?.water_status &&
      field.report?.causes && field.report?.history && field.report?.recommendations &&
      field.report?.satellite && field.report?.terrain && field.report?.soil && field.report?.hydrology) : [];
  } catch {
    return [];
  }
}

/** Dane pola dla serwera (`POST /api/fields`). Dzisiejsza data = pole „na dziś”: serwer przelicza je codziennie.
 *  W trybie testowym raport liczy się dla punktu, a obrys testowy dorysowuje frontend. */
export function fieldInput({ name = '', parcel, point, crop, date, test = false,
  sowing_date, harvest_date, next_sowing_date }) {
  return {
    name: name.trim(), crop, date: date === today() ? null : date, test,
    ...(sowing_date ? { sowing_date } : {}),
    ...(harvest_date ? { harvest_date } : {}),
    ...(next_sowing_date ? { next_sowing_date } : {}),
    ...(parcel && !test ? { parcel_id: parcel.id } : { point: { lat: point.lat, lon: point.lon } }),
  };
}

/** Dane pola z gotowego raportu (raport z linku, pola zapisane dawniej w przeglądarce). Raport liczony na dzień,
 *  w którym powstał, oznacza pole „na dziś”. */
export function inputFromReport(report, name = '') {
  const test = report.parcel?.id === 'TEST';
  const forToday = report.analysis_date === report.generated_at?.slice(0, 10);
  return fieldInput({
    ...report.request,
    name, crop: report.crop.key, date: forToday ? today() : report.analysis_date, test,
    parcel: report.request.parcel_id && !test ? { id: report.request.parcel_id } : null,
    point: report.request.point ?? report.parcel?.centroid,
  });
}

/** Czy dane do analizy się zmieniły (sama zmiana nazwy nie wymaga liczenia). */
export function sameReportInputs(initial, form) {
  const saved = initial?.input;
  if (!saved) return false;
  const next = fieldInput(form);
  return next.crop === saved.crop && next.date === (saved.date ?? null) && next.test === Boolean(saved.test)
    && ['sowing_date', 'harvest_date', 'next_sowing_date'].every((key) => (next[key] ?? null) === (saved[key] ?? null))
    && (next.parcel_id ?? null) === (saved.parcel_id ?? null)
    && next.point?.lat === saved.point?.lat && next.point?.lon === saved.point?.lon;
}

/** Obrys testowy (adres z ?test) dorysowany do raportu, który serwer policzył dla punktu. */
export function withTestShape(field) {
  const point = field.input?.test && field.report?.request?.point;
  if (!point) return field;
  const shape = testParcel(point.lat, point.lon);
  return { ...field, report: { ...field.report, parcel: shape.parcel, test_crop_area: shape.cropArea } };
}

/** Czy serwer zmienił coś, co widać w aplikacji (nazwa, stan liczenia, błąd, odświeżenie, etap). */
function unchanged(old, field) {
  return old.name === field.name && old.job === field.job && old.error === field.error
    && old.refreshed_at === field.refreshed_at && JSON.stringify(old.progress ?? null) === JSON.stringify(field.progress ?? null);
}

/** Lista z serwera. Pole bez zmian zostaje tym samym obiektem, więc otwarty raport się nie przeładowuje
 *  i nie gubi dociągniętych w przeglądarce zdjęć satelitarnych. */
export function mergeFields(previous, next) {
  return next.map((field) => {
    const old = previous.find((entry) => entry.id === field.id);
    return old && unchanged(old, field) ? old : withTestShape(field);
  });
}

/** Czy serwer jeszcze liczy raport któregoś pola (wtedy listę odpytujemy częściej). */
export const anyBusy = (fields) => fields.some((field) => field.job === 'queued' || field.job === 'running');

const URGENCY = { severe: 0, moderate: 1, watch: 2, none: 3 };
/** Pola od najpilniejszego (silny niedobór na górze); pola bez oceny na końcu. */
export function byUrgency(fields) {
  const rank = (field) => URGENCY[field.report?.water_status?.class_key] ?? 4;
  return [...fields].sort((a, b) => rank(a) - rank(b));
}

// Kiedy wykonać działanie (serwer: `timing`); starsze zapisane raporty go nie mają.
export const TIMING = { now: 'teraz', after_harvest: 'po zbiorze', long_term: 'na kolejne sezony' };

/** Działanie do wyróżnienia: pierwsze „na teraz” w kolejności grup (retencja pierwsza), potem „po zbiorze”, potem pierwsze. */
export function firstAction(actions) {
  return actions.find((action) => action.timing === 'now') ?? actions.find((action) => action.timing === 'after_harvest') ?? actions[0];
}

/** Pierwsze działanie każdego pola, od najpilniejszego pola. */
export function actionItems(fields) {
  return byUrgency(fields)
    .flatMap((field) => {
      const { retention = [], agrotechnical = [], irrigation = [], field_checks = [] } = field.report?.recommendations ?? {};
      // Retencja ma zawsze pierwszeństwo przed nawadnianiem (kolejność narzucona przez zadanie KOWR).
      const first = firstAction([...retention, ...agrotechnical, ...field_checks]) ?? irrigation[0];
      return first ? [{ field, action: first }] : [];
    });
}
