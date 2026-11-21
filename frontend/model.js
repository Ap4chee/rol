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

export const TABS = ['podsumowanie', 'rekomendacje', 'gleba', 'pogoda', 'teren', 'historia', 'zrodla'];

/** Pole z adresu: `#pole/<id>` albo `#pole/<id>/<zakładka>` (id zakodowane, więc bez „/”), `#podglad[/zakładka]`. */
export function route(hash) {
  return routeTab(hash).id;
}

export function routeTab(hash) {
  const [head, encoded, tab] = hash.replace(/^#/, '').split('/');
  const known = TABS.includes(tab) ? tab : TABS[0];
  if (head === 'podglad') return { id: 'preview', tab: TABS.includes(encoded) ? encoded : TABS[0] };
  if (head !== 'pole' || !encoded) return { id: null, tab: known };
  try { return { id: decodeURIComponent(encoded), tab: known }; } catch { return { id: null, tab: known }; }
}

export function fieldTabHref(id, tab) {
  return id === 'preview' ? `#podglad/${tab}` : `${fieldHref(id)}/${tab}`;
}

const URGENCY = { severe: 0, moderate: 1, watch: 2, none: 3 };
/** Pola od najpilniejszego (silny niedobór na górze); pola bez oceny na końcu. */
export function byUrgency(fields) {
  return [...fields].sort((a, b) => (URGENCY[a.report.water_status.class_key] ?? 4) - (URGENCY[b.report.water_status.class_key] ?? 4));
}

export function actionItems(fields) {
  return byUrgency(fields)
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

/** Jaka część warstwy [0–1] leży nad głębokością `depthCm` (rzeczywiste przecięcie, nie sam początek warstwy). */
export function shareAbove(layer, depthCm) {
  const thickness = layer.bottom_cm - layer.top_cm;
  if (!(depthCm > 0) || thickness <= 0) return 0;
  return Math.min(1, Math.max(0, (depthCm - layer.top_cm) / thickness));
}

const reach = (share) => (share >= 1 ? 'full' : share > 0 ? 'partial' : 'none');

/**
 * Wspólne znaczenie profilu gleby dla tabeli i modelu 3D.
 * - `balanceCm`: strefa korzeni liczona w bilansie (stała na cały sezon, FAO-56);
 * - `rootsNowCm`: głębokość korzeni w dniu analizy (rośnie od siewu; null, gdy uprawy nie ma na polu);
 * - każda warstwa (po scaleniu sąsiednich tej samej klasy) dostaje udział i zasięg względem obu głębokości:
 *   'full' | 'partial' | 'none'. Brak profilu to `missing: true`, a nie warstwa umowna.
 */
export function soilProfile(report) {
  const balanceCm = (report.soil?.root_depth_m ?? report.crop?.root_depth_m ?? 0) * 100;
  const rootsNowCm = report.crop?.root_depth_now_m != null ? report.crop.root_depth_now_m * 100 : null;
  const layers = mergeSoilLayers(report.soil?.layers).map((layer) => {
    const balanceShare = shareAbove(layer, balanceCm);
    const rootsShare = rootsNowCm == null ? 0 : shareAbove(layer, rootsNowCm);
    return { ...layer, balanceShare, balance: reach(balanceShare), rootsShare, roots: reach(rootsShare) };
  });
  return {
    layers, balanceCm, rootsNowCm, missing: layers.length === 0,
    belowBalance: balanceCm > 0 && layers.some((layer) => layer.balance === 'none'),
  };
}

/** Krótki opis zasięgu warstwy do tabeli i dymku, np. „w strefie bilansu”, „w strefie bilansu do 80 cm”. */
export function balanceText(layer, balanceCm) {
  if (layer.balance === 'full') return 'w strefie bilansu';
  if (layer.balance === 'partial') return `w strefie bilansu do ${number(balanceCm)} cm`;
  return 'poniżej strefy bilansu';
}

export const layersWord =(n) => (n === 1 ? 'warstwa' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'warstwy' : 'warstw');
