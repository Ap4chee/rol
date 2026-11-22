import { Plus } from 'lucide-react';
import { dateText } from '@/shared/format/date';
import { Button } from '@/shared/ui/button';
import { Callout } from '@/shared/ui/callout';
import { LoadingState } from '@/shared/ui/effects';
import { sharedParams } from './useSharedReport.js';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Raport z udostępnionego linku w trakcie liczenia: pikselowy wskaźnik z licznikiem czasu na środku panelu. */
export function SharedLoading() {
  const params = sharedParams();
  const parcel = params.get('parcel'), date = params.get('date');
  return <div className="grid flex-1 place-items-center py-16">
    <div className="flex max-w-full flex-col items-center gap-3 text-center">
      <p role="status" className="sr-only">Pobieram dane i liczę raport dla wskazanej działki…</p>
      {/* licznik odświeża się co 0,1 s, więc część wizualna jest ukryta przed czytnikami (komunikat jest wyżej);
          na wąskim ekranie podpis łamie się do lewej, a licznik (ostatni element) zostaje w jednej linii */}
      <div aria-hidden className="max-w-full">
        <LoadingState label="Pobieram dane i liczę raport dla wskazanej działki"
          className="max-w-full text-left [&>span:last-child]:whitespace-nowrap [&>span:nth-of-type(2)]:text-balance"/>
      </div>
      <p className="num wrap-anywhere font-mono text-[12px] text-neutral-500">
        Działka {parcel}{ISO_DATE.test(date ?? '') && <> · {dateText(date)}</>}
      </p>
    </div>
  </div>;
}

/** Adres wskazuje pole, którego nie ma w zapisanych w tej przeglądarce. */
export function NotFound({ onAdd }) {
  return <Callout tone="neutral" className="mb-6 [&>div]:flex-1">
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5">
      <div className="min-w-0">
        <p className="font-medium text-neutral-900">Nie znaleziono raportu w tej przeglądarce.</p>
        <p className="mt-0.5 text-neutral-500">Zapisane pola są przechowywane tylko w przeglądarce, w której je dodano.</p>
      </div>
      {/* pseudo-element powiększa cel dotyku do 40 px bez powiększania przycisku */}
      <Button variant="secondary" size="sm" icon={<Plus/>} onClick={onAdd} className="after:absolute after:-inset-1">Dodaj pole</Button>
    </div>
  </Callout>;
}
