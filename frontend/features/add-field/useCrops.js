import { useEffect, useState } from 'react';
import { listCrops } from '@/api/endpoints';

/** Uprawy do wyboru: null, dopóki lista się wczytuje; błąd jako tekst. */
export function useCrops() {
  const [crops, setCrops] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    listCrops(controller.signal)
      .then(setCrops)
      .catch((err) => { if (!controller.signal.aborted) setError(err.message); });
    return () => controller.abort();
  }, []);
  return { crops, error };
}
