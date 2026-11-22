import { LoaderCircle } from 'lucide-react';
import { StatusBadge } from '@/shared/ui/status';

// Stan liczenia raportu na serwerze (app/fields.py): worker liczy raport po dodaniu pola i raz na dobę.
export const JOB = { queued: 'W kolejce', running: 'Liczę raport', error: 'Nie udało się policzyć' };

/** Plakietka liczenia: kręci się, dopóki serwer liczy; przy błędzie podaje powód w podpowiedzi. */
export function JobBadge({ field, className }) {
  if (!JOB[field.job]) return null;
  const failed = field.job === 'error';
  const label = !field.report ? JOB[field.job] : failed ? 'Nie odświeżono' : 'Odświeżam raport';
  return <StatusBadge tone={failed ? 'severe' : 'info'} size="sm" spin={!failed} icon={failed ? undefined : LoaderCircle}
    title={field.error ?? undefined} className={className}>{label}</StatusBadge>;
}
