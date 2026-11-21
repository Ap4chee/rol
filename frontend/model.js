export const STORAGE_KEY = 'kowr.saved-fields.v1';
export const FULL_ID = /^\d{6}_\d\.\d{4}\.(AR_\d+\.)?[A-Za-z0-9/._-]+$/;

export function today() {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Warsaw' }).format(new Date());
}

export function oldestDate(date = today()) {
  const year = Number(date.slice(0, 4)) - 10;
  const monthDay = date.slice(4);
  const calendarDate = new Date(`${year}${monthDay}T12:00:00Z`);
  return calendarDate.getUTCMonth() === 2 && monthDay === '-02-29' ? `${year}-02-28` : year + monthDay;
}

export const number = (value, digits = 0) => Number.isFinite(value)
  ? (Math.abs(value) < .5 * 10 ** -digits ? 0 : value).toLocaleString('pl-PL', { maximumFractionDigits: digits }) : '—';
export const dateText = (iso) => iso ? iso.slice(0, 10).split('-').reverse().join('.') : '—';

export function waterPercent(result) {
  if (!result || !Number.isFinite(result.available_mm) || !(result.taw_mm > 0)) return null;
  return Math.min(100, Math.max(0, 100 * result.available_mm / result.taw_mm));
}

export function satelliteMeasurements(satellite) {
  return (satellite?.observations ?? [])
    .filter((point) => point.accepted && point.date && Number.isFinite(point.ndvi))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function fieldFromReport(report, name = '') {
  const point = report.request.point;
  const id = report.parcel?.id ?? report.request.parcel_id ?? `punkt:${point.lat},${point.lon}`;
  const title = name.trim() || (report.parcel?.number ? `Działka ${report.parcel.number}` : point ? 'Wskazany punkt' : id);
  return { id, name: title, report };
}

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

export function upsertField(fields, field) {
  return fields.some(({ id }) => id === field.id)
    ? fields.map((entry) => entry.id === field.id ? field : entry)
    : [field, ...fields];
}

export function fieldHref(id) {
  return '#pole/' + encodeURIComponent(id);
}

export function route(hash) {
  if (!hash.startsWith('#pole/')) return hash === '#podglad' ? 'preview' : null;
  try { return decodeURIComponent(hash.slice(6)); } catch { return null; }
}

export function actionItems(fields) {
  const urgency = { severe: 0, moderate: 1, watch: 2, none: 3 };
  return [...fields]
    .sort((a, b) => (urgency[a.report.water_status.class_key] ?? 4) - (urgency[b.report.water_status.class_key] ?? 4))
    .flatMap((field) => {
      const { retention = [], agrotechnical = [], irrigation = [], field_checks = [] } = field.report.recommendations ?? {};
      const first = (field.report.water_status.class_key === 'severe' ? irrigation[0] : null)
        ?? retention[0] ?? agrotechnical[0] ?? irrigation[0] ?? field_checks[0];
      return first ? [{ field, action: first }] : [];
    });
}

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

/** Sąsiednie warstwy SoilGrids o tej samej klasie gleby jako jedna warstwa: woda dostępna sumowana,
 *  udziały frakcji, pojemności i węgiel uśrednione ważone grubością. */
export function mergeSoilLayers(layers) {
  const out = [];
  for (const layer of layers ?? []) {
    const last = out.at(-1);
    if (!last || last.texture_key !== layer.texture_key || last.bottom_cm !== layer.top_cm) {
      out.push({ ...layer });
      continue;
    }
    const a = last.bottom_cm - last.top_cm, b = layer.bottom_cm - layer.top_cm;
    const mean = (key) => (last[key] == null || layer[key] == null ? null : (last[key] * a + layer[key] * b) / (a + b));
    for (const key of ['sand_pct', 'silt_pct', 'clay_pct', 'field_capacity_vol_pct', 'wilting_point_vol_pct', 'soc_g_kg']) last[key] = mean(key);
    last.available_water_mm += layer.available_water_mm;
    last.bottom_cm = layer.bottom_cm;
  }
  return out;
}

export const layersWord = (n) => (n === 1 ? 'warstwa' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'warstwy' : 'warstw');
