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

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePrinting() {
  return useSyncExternalStore(subscribe, () => printing, () => false);
}
