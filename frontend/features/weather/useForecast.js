import { useEffect, useState } from 'react';
import { forecast as fetchForecast, forecastQuery } from '@/api/endpoints';
import { FORECAST_DAYS } from './logic.js';

// Odpowiedzi prognozy według zapytania. Raport pobiera prognozę od razu po otwarciu (prefetchForecast), a układ wydruku
// montuje zakładkę pogody dopiero przy drukowaniu: z pamięci ma dane od pierwszego rysowania i nie drukuje szkieletu.
const cache = new Map();

function load(query) {
  let entry = cache.get(query);
  if (!entry) {
    entry = { data: null };
    entry.promise = fetchForecast(query)
      .catch((error) => ({ status: 'error', reason: error.message }))
      .then((data) => {
        // błędu nie zapamiętujemy: kolejne otwarcie spróbuje jeszcze raz
        if (data?.status === 'error') cache.delete(query); else entry.data = data;
        return data;
      });
    cache.set(query, entry);
  }
  return entry;
}

/** Zaczyna pobierać prognozę dla pozycji pola, zanim ktoś otworzy zakładkę pogody albo wydruk. */
export function prefetchForecast(position) {
  if (position) load(forecastQuery(position, FORECAST_DAYS));
}

/** Prognoza dla zapytania z `forecastQuery`; null, dopóki odpowiedź dla tego zapytania nie przyjdzie.
 *  Błąd sieci wraca jako sekcja z `status: 'error'`, tak jak błąd zgłoszony przez serwer. */
export function useForecast(query) {
  const [weather, setWeather] = useState(() => {
    const data = query ? cache.get(query)?.data : null;
    return data ? { query, data } : null;
  });
  useEffect(() => {
    if (!query) return undefined;
    let active = true;
    load(query).promise.then((data) => { if (active) setWeather({ query, data }); });
    return () => { active = false; };
  }, [query]);
  // odpowiedź dla poprzedniego pola nie pokazuje się pod nowym, zanim przyjdzie właściwa
  return weather?.query === query ? weather.data : null;
}
