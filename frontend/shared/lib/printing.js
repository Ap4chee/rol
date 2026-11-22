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
  // Ctrl+P / Cmd+P idzie tą samą drogą co „Pobierz PDF”: bez tego przeglądarka robi zrzut od razu,
  // zanim mapa i prognoza w układzie wydruku zdążą się wczytać
  window.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'p') {
      event.preventDefault();
      if (!preparing) printWhenReady();
    }
  });
}

let preparing = false;      // trwa składanie wydruku: drugi Ctrl+P ani klik nie zaczyna kolejnego

const MIN_WAIT_MS = 400;     // czas na zamontowanie zakładek i start pobierania
const POLL_MS = 200;
// teren liczy się zwykle 15–60 s, a mapa w układzie wydruku pobiera kafle od nowa: 20 s nie wystarczało
const MAX_WAIT_MS = 45000;   // dłużej nie czekamy: drukujemy to, co jest (np. gdy serwer map nie odpowiada)

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
  if (preparing) return;
  preparing = true;
  try { await prepareAndPrint(); } finally { preparing = false; }
}

async function prepareAndPrint() {
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
