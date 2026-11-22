import { useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';

// Stan drukowania dla całej aplikacji. Przy drukowaniu raport składa wszystkie zakładki jedna pod drugą,
// a zwinięte sekcje renderują się rozwinięte. flushSync: zanim przeglądarka zrobi zrzut strony.
let printing = false;
const listeners = new Set();

function set(value) {
  if (printing === value) return;
  printing = value;
  flushSync(() => listeners.forEach((listener) => listener()));
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeprint', () => set(true));
  window.addEventListener('afterprint', () => set(false));
}

const MIN_WAIT_MS = 400;     // czas na zamontowanie zakładek i start pobierania
const POLL_MS = 200;
const MAX_WAIT_MS = 20000;   // dłużej nie czekamy: drukujemy to, co jest (np. gdy serwer map nie odpowiada)

/** Czy coś na stronie jeszcze się wczytuje: element z `data-print-pending` (mapa, prognoza) albo obrazek.
 *  Teren liczy się osobno i bywa wolniejszy niż limit: wtedy na wydruku zostaje informacja, że się liczy. */
function stillLoading() {
  return Boolean(document.querySelector('[data-print-pending]'))
    || Array.from(document.images).some((image) => !image.complete);
}

/**
 * Druk z przycisku „Pobierz PDF”. Układ wydruku montuje wszystkie zakładki naraz, a mapa, prognoza i obrazki
 * potrzebują chwili na pobranie danych. Samo window.print() robi zrzut od razu i te części wychodziły puste,
 * więc najpierw składamy układ wydruku na ekranie, czekamy, aż się wczyta, i dopiero otwieramy okno druku.
 */
export async function printWhenReady() {
  set(true);
  // odroczone obrazki (loading="lazy") poza ekranem nie wczytałyby się przed zrzutem
  document.querySelectorAll('img[loading="lazy"]').forEach((image) => { image.loading = 'eager'; });
  const started = Date.now();
  await new Promise((resolve) => setTimeout(resolve, MIN_WAIT_MS));
  while (stillLoading() && Date.now() - started < MAX_WAIT_MS) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  window.print();
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePrinting() {
  return useSyncExternalStore(subscribe, () => printing, () => false);
}
