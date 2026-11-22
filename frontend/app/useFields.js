import { useCallback, useEffect, useRef, useState } from 'react';
import { listFields, saveField } from '@/api/endpoints';
import { anyBusy, inputFromReport, mergeFields, readFields, STORAGE_KEY } from '@/features/fields/logic';

// W trakcie liczenia często, żeby było widać kolejne etapy; poza tym raz na minutę (serwer odświeża raporty raz na dobę).
const BUSY_POLL_MS = 1200;
const IDLE_POLL_MS = 60_000;

/** Pola zapisane dawniej tylko w tej przeglądarce przenosimy na serwer; przy błędzie zostają i wracamy do nich później. */
async function migrateLocalFields() {
  let local = [];
  try { local = readFields(window.localStorage); } catch { /* brak dostępu do pamięci przeglądarki */ }
  try {
    for (const field of local) await saveField(inputFromReport(field.report, field.name));
    if (local.length) window.localStorage.removeItem(STORAGE_KEY);
  } catch { /* spróbujemy przy następnym wejściu */ }
}

/**
 * Lista pól z serwera (raporty liczy tam worker, app/fields.py) odpytywana w tle.
 * `update` zmienia listę lokalnie, np. po dociągnięciu zdjęć satelitarnych w przeglądarce.
 */
export function useFields() {
  const [fields, setFields] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [message, setMessage] = useState('');
  const current = useRef(fields);   // dla odpytywania, które żyje dłużej niż jeden render
  const poll = useRef(0);

  const show = useCallback((next) => {
    current.current = next;
    setFields(next);
  }, []);

  const refresh = useCallback(async () => {
    try {
      show(mergeFields(current.current, await listFields()));
      setMessage('');
    } catch (error) {
      setMessage(`Nie udało się wczytać pól z serwera: ${error.message}`);
    }
    setLoaded(true);
    clearTimeout(poll.current);
    poll.current = setTimeout(refresh, anyBusy(current.current) ? BUSY_POLL_MS : IDLE_POLL_MS);
  }, [show]);

  useEffect(() => {
    migrateLocalFields().then(refresh);
    return () => clearTimeout(poll.current);
  }, [refresh]);

  const update = useCallback((change) => show(current.current.map(change)), [show]);

  return { fields, loaded, message, refresh, update };
}
