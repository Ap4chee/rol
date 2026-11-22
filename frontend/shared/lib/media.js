import { useCallback, useSyncExternalStore } from 'react';

/** Czy pasuje zapytanie CSS (np. '(max-width: 47.99rem)'); odświeża się przy zmianie rozmiaru okna. */
export function useMediaQuery(query) {
  const subscribe = useCallback((onChange) => {
    const list = window.matchMedia(query);
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [query]);
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => false);
}

/** Telefon: węższy niż próg md (48rem) z Tailwind. */
export const NARROW = '(max-width: 47.99rem)';

/** Komputer: od progu md (48rem); menu jest wtedy stałym paskiem bocznym, a nie szufladą. */
export const DESKTOP = '(min-width: 48rem)';
