import { useEffect, useState } from 'react';
import { generateReport } from '@/api/endpoints';
import { fieldFromReport } from '@/features/fields/logic';
import { PREVIEW_HREF } from './router.js';
import { navigate } from './useHashRoute.js';

/** Parametry raportu z udostępnionego linku (`?parcel=…&crop=…&date=…`). */
export const sharedParams = () => new URLSearchParams(window.location.search);

/**
 * Raport z udostępnionego linku liczony na wejściu, pokazywany jako podgląd (`#podglad`).
 * `status`: 'loading' w trakcie, '' gdy gotowe albo linku nie ma, inaczej komunikat błędu.
 */
export function useSharedReport() {
  const [preview, setPreview] = useState(null);
  const [status, setStatus] = useState(() => (sharedParams().get('parcel') ? 'loading' : ''));

  useEffect(() => {
    const params = sharedParams();
    const parcelId = params.get('parcel'), crop = params.get('crop'), date = params.get('date');
    if (!parcelId) return undefined;
    const controller = new AbortController();
    if (!(crop && date)) {
      setStatus('Link do raportu musi zawierać numer działki, uprawę i datę.');
      return () => controller.abort();
    }
    generateReport({ parcel_id: parcelId, crop, date }, controller.signal).then((report) => {
      setPreview(fieldFromReport(report));
      setStatus('');
      navigate(PREVIEW_HREF);
    }).catch((error) => { if (!controller.signal.aborted) setStatus(error.message); });
    return () => controller.abort();
  }, []);

  return { preview, setPreview, status };
}
