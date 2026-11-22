// Profil gleby z raportu (warstwy SoilGrids) w znaczeniu dla rolnika: które warstwy liczą się do bilansu wody
// i dokąd sięgają korzenie. Wspólne dla tabeli i modelu 3D; bez Reacta i three.js.
import { number } from '../../shared/format/number.js';
import { plural } from '../../shared/format/plural.js';

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
 * `balanceCm` to strefa korzeni liczona w bilansie (stała na cały sezon, FAO-56), a `rootsNowCm` głębokość korzeni
 * w dniu analizy (rośnie od siewu; null, gdy uprawy nie ma na polu). Każda warstwa po scaleniu dostaje udział
 * i zasięg względem obu głębokości: 'full' | 'partial' | 'none'. Brak profilu to `missing: true`, a nie warstwa umowna.
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

export const layersWord = (n) => plural(n, 'warstwa', 'warstwy', 'warstw');
