import { useEffect, useState } from 'react';
import { forecast as fetchForecast } from '@/api/endpoints';

/** Prognoza dla zapytania z `forecastQuery`; null, dopóki odpowiedź dla tego zapytania nie przyjdzie.
 *  Błąd sieci wraca jako sekcja z `status: 'error'`, tak jak błąd zgłoszony przez serwer. */
export function useForecast(query) {
  const [weather, setWeather] = useState(null);
  useEffect(() => {
    if (!query) return undefined;
    const controller = new AbortController();
    fetchForecast(query, controller.signal).then((data) => setWeather({ query, data }))
      .catch((error) => { if (!controller.signal.aborted) setWeather({ query, data: { status: 'error', reason: error.message } }); });
    return () => controller.abort();
  }, [query]);
  // odpowiedź dla poprzedniego pola nie pokazuje się pod nowym, zanim przyjdzie właściwa
  return weather?.query === query ? weather.data : null;
}
