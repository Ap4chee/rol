// Jedno miejsce, które rozmawia z serwerem po HTTP: limit czasu, łączenie sygnałów przerwania i polski komunikat błędu.
// Adresy i kształty zapytań są w endpoints.js.

/** Domyślny limit czasu; raport z pełną analizą zwykle mieści się w minucie. */
export const DEFAULT_TIMEOUT_MS = 75_000;

/**
 * Komunikat błędu z odpowiedzi serwera. FastAPI oddaje `detail` jako tekst albo jako listę błędów walidacji
 * (wtedy sklejamy ich `msg`); bez czytelnego opisu zostaje sam kod odpowiedzi.
 */
export function errorMessage(status, data) {
  const detail = data?.detail;
  if (Array.isArray(detail)) return detail.map((row) => row.msg).join(' ');
  if (typeof detail === 'string') return detail;
  return `Błąd odpowiedzi serwera (${status}).`;
}

/** JSON z serwera albo wyjątek z polskim komunikatem. Przerwanie przez `signal` i przekroczenie limitu też rzucają. */
export async function request(url, { signal, timeoutMs = DEFAULT_TIMEOUT_MS, json, ...init } = {}) {
  const timeout = AbortSignal.timeout(timeoutMs);
  const body = json === undefined ? init.body : JSON.stringify(json);
  const headers = json === undefined ? init.headers : { 'Content-Type': 'application/json', ...init.headers };
  const response = await fetch(url, { ...init, body, headers, signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) throw new Error(errorMessage(response.status, data));
  return data;
}
