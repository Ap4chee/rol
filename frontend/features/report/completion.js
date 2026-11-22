/**
 * Uzupełnianie raportu o części liczone osobno (zdjęcia satelitarne, teren): oczekiwanie, ponowne zapytanie,
 * gdy serwer nadal odpowiada „pending”, ponowienie po błędzie i scalenie wyniku z raportem.
 * Ekran, wydruk i zapis korzystają z tej samej, scalonej wersji raportu. Tu są czyste reguły (bez Reacta i sieci);
 * cykl zapytań jest w useCompletion.js.
 */

export const POLL_DELAY_MS = 8_000;   // odstęp kolejnego zapytania, gdy serwer nadal wczytuje dane
export const MAX_POLLS = 8;           // tyle razy pytamy ponownie, zanim pokażemy „Ponów”
export const STILL_PENDING = 'Dane nadal się wczytują po stronie serwera. Spróbuj ponownie za chwilę.';

const PART = {
  satellite: { section: (result) => result?.satellite, source: (result) => result?.source },
  terrain: { section: (result) => result, source: (result) => result?.source },
};

/** Co zrobić z odpowiedzią: 'done' (wynik ostateczny), 'poll' (zapytać znowu), 'exhausted' (dość prób). */
export function nextStep(kind, result, polls) {
  if (PART[kind].section(result)?.status !== 'pending') return 'done';
  return polls < MAX_POLLS ? 'poll' : 'exhausted';
}

/** Część raportu do pokazania: dociągnięty wynik, błąd połączenia albo stan z samego raportu. */
export function partSection(kind, report, state) {
  const fetched = PART[kind].section(state.result);
  const known = fetched ?? report[kind];
  if (state.failure) return { ...known, status: 'error', reason: state.failure };
  if (state.exhausted) return { ...known, status: 'error', reason: STILL_PENDING };
  return known;
}

function withSource(sources, source) {
  return source ? [...(sources ?? []).filter((entry) => entry.key !== source.key), source] : sources ?? [];
}

function uniqueByKey(items) {
  return [...new Map(items.map((item) => [item.key, item])).values()];
}

/** Raport z dociągniętym wynikiem satelitarnym: sekcja, wpis źródła i sprawdzenia w polu (bez duplikatów). */
export function mergeSatellite(report, result) {
  if (!result) return report;
  return {
    ...report, satellite: result.satellite ?? report.satellite, sources: withSource(report.sources, result.source),
    recommendations: { ...report.recommendations, field_checks: uniqueByKey([
      ...(report.recommendations?.field_checks ?? []), ...(result.field_checks ?? [])]) },
  };
}

/** Raport z dociągniętym terenem: sekcja i wpis źródła. */
export function mergeTerrain(report, terrain) {
  if (!terrain) return report;
  return { ...report, terrain, sources: withSource(report.sources, terrain.source) };
}

/** Jedna wersja raportu z obiema częściami w ich bieżącym stanie (także oczekiwanie i błąd). */
export function completeReport(report, satellite, terrain) {
  const sat = partSection('satellite', report, satellite);
  const topo = partSection('terrain', report, terrain);
  const merged = mergeTerrain(mergeSatellite(report, satellite.result), terrain.result);
  return { ...merged, satellite: sat, terrain: topo };
}
