// Wszystkie zapytania frontendu do serwera, nazwane po tym, co zwracają. Kontrakt jest w docs/kontrakt_api.md.
import { request } from './client.js';

// Zdjęcia satelitarne i analiza terenu liczą się po stronie serwera dłużej niż raport; serwer i tak ma swoje limity,
// tu tylko nie przerywamy wcześniej niż on.
const SATELLITE_TIMEOUT_MS = 125_000;
const TERRAIN_TIMEOUT_MS = 200_000;
const PART_TIMEOUT_MS = { satellite: SATELLITE_TIMEOUT_MS, terrain: TERRAIN_TIMEOUT_MS };

/** Raport dla działki albo punktu na dany dzień (`POST /api/report`). */
export const generateReport = (body, signal) => request('/api/report', { method: 'POST', json: body, signal });

/** Pola zapisane na serwerze; raporty liczy tam worker (zaraz po zapisie, potem raz na dobę). */
export const listFields = (signal) => request('/api/fields', { signal });

/** Zapis pola; przy edycji `previousId` mówi, które pole zastępujemy (działka mogła się zmienić). */
export function saveField(input, previousId, signal) {
  const query = previousId ? '?previous_id=' + encodeURIComponent(previousId) : '';
  return request('/api/fields' + query, { method: 'POST', json: input, signal });
}

export const deleteField = (id) => request('/api/fields?id=' + encodeURIComponent(id), { method: 'DELETE' });

/** Uprawy do wyboru w formularzu. */
export const listCrops = (signal) => request('/api/crops', { signal });

export const parcelById = (id, signal) => request('/api/parcels/by-id?id=' + encodeURIComponent(id), { signal });

/** Działka w punkcie mapy ({ lat, lon }, EPSG:4326). */
export const parcelAtPoint = (point, signal) => request('/api/parcels/by-point?' + new URLSearchParams(point), { signal });

/** Działki po nazwie obrębu i numerze. */
export const searchParcels = (query, signal) => request('/api/parcels/search?q=' + encodeURIComponent(query), { signal });

/** Miejsca po adresie albo nazwie miejscowości. */
export const searchAddresses = (query, signal) => request('/api/addresses/search', { method: 'POST', json: { query }, signal });

/** Parametry zapytania o prognozę dla punktu; ten sam napis służy w komponencie jako klucz pamięci. */
export const forecastQuery = ({ lat, lon }, days) => new URLSearchParams({ lat, lon, days: String(days) }).toString();

/** Prognoza pogody (Open-Meteo przez serwer) dla zapytania z `forecastQuery`. */
export const forecast = (query, signal) => request('/api/forecast?' + query, { signal });

/** Plan prac polowych dla zapytania z `fieldworkQuery` (features/fieldwork/logic.js). */
export const fieldworkPlan = (query, signal) => request('/api/fieldwork?' + query, { signal });

/** Część raportu liczona osobno (satelita, teren). Adres podaje sam raport w `endpoint` sekcji. */
export const reportPart = (kind, endpoint, signal) => request(endpoint, { signal, timeoutMs: PART_TIMEOUT_MS[kind] });

/** Granice jednostek administracyjnych do mapy pól (static/mapa, pliki statyczne, nie API). */
export async function adminBoundaries(name) {
  const response = await fetch(`/mapa/${name}.json`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}
