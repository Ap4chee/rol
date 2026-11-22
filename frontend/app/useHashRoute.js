import { useEffect, useState } from 'react';

/** Bieżący adres po „#”; zmienia się przy każdym przejściu (linki, „wstecz” przeglądarki, `navigate`). */
export function useHash() {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    function change() { setHash(window.location.hash); }
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);
  return hash;
}

/** Przejście do widoku z app/router.js (np. `fieldHref(id)`); wpis trafia do historii przeglądarki. */
export function navigate(href) {
  window.location.hash = href;
}

/** Podmiana adresu bez wpisu w historii (stary adres, który tylko otwiera okno). */
export function replaceHash(href) {
  window.history.replaceState(null, '', href);
}
