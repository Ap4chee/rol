import { useId, useRef } from 'react';
import { Calendar, Check, X } from 'lucide-react';
import { DatePicker } from '@/shared/ui/date-picker';
import { Field } from '@/shared/ui/field';
import { cn } from '@/shared/lib/cn';

/** Pole daty z kalendarzem w okienku (data analizy). */
export function DateField({ label, hint, value, onChange, disabled, required, min, max }) {
  return <Field label={label} hint={hint} required={required}>{(id, describedBy) =>
    <DatePicker id={id} label={label} describedBy={describedBy} value={value} onChange={onChange}
      min={min} max={max} disabled={disabled} variant="secondary" icon={<Calendar className="text-neutral-400"/>}
      className="num w-full justify-start px-3"/>}
  </Field>;
}

/** Jeden termin na osi sezonu: kółko z ikoną (ptaszek po wpisaniu), kalendarz i przycisk czyszczenia. */
export function TimelineDate({ label, value, onChange, error, disabled, icon: Icon, referenceDate }) {
  const id = useId();
  const trigger = useRef(null);
  const filled = value && !error;

  return <li className="relative min-w-0 text-center">
    <div className="relative mx-auto max-w-40 px-1 pb-1">
      <span aria-hidden className={cn(
        'mx-auto grid size-8 place-items-center rounded-full border transition-colors',
        'duration-150 ease-[var(--ease-out)] motion-reduce:transition-none',
        error ? 'border-severe/40 bg-severe-soft text-severe-ink'
          : filled ? 'border-brand-700 bg-brand-700 text-white' : 'border-brand-200 bg-white text-brand-700',
      )}>
        {filled ? <Check className="size-4 animate-in zoom-in-75 duration-150 motion-reduce:animate-none"/> : <Icon className="size-4"/>}
      </span>
      <span className="mt-2 grid min-h-8 place-items-center text-[12px] leading-4 font-medium text-neutral-800 sm:text-[13px]">
        {label}
      </span>
      <DatePicker triggerRef={trigger} label={label} referenceDate={referenceDate} value={value} onChange={onChange}
        disabled={disabled} invalid={Boolean(error)} describedBy={error ? id : undefined} variant={value ? 'soft' : 'ghost'}
        className={cn('num mt-0.5 h-8 rounded-lg px-1.5 text-[12px] sm:px-2.5 sm:text-[13px]',
          value ? 'font-semibold' : 'bg-neutral-100')}/>
    </div>
    {value && <button type="button" aria-label={`Wyczyść datę: ${label}`} disabled={disabled}
      className="press mx-auto grid size-7 place-items-center rounded-md text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900"
      onClick={() => { onChange(''); trigger.current?.focus(); }}><X aria-hidden className="size-3.5"/></button>}
    {error && <p id={id} role="alert" className="mt-1 px-0.5 text-[11px] font-medium leading-tight text-severe-ink sm:text-xs">{error}</p>}
  </li>;
}


/** Oś sezonu: siew, zbiór i kolejny siew; odcinek między terminami zapełnia się, gdy oba są poprawne. */
export function SeasonTimeline({ fields, referenceDate, disabled }) {
  return <section className="surface min-w-0 p-3 sm:p-5" aria-label="Terminy sezonu">
    <h3 className="text-base font-semibold">Terminy sezonu <span className="font-normal text-neutral-500">(opcjonalnie)</span></h3>
    <p className="mt-1 text-[13px] leading-snug text-neutral-600">
      Podaj znane lub planowane daty. Puste terminy oszacujemy z kalendarza uprawy.
    </p>
    <div className="relative mx-auto mt-4 max-w-3xl">
      <div aria-hidden className="pointer-events-none absolute inset-x-1/6 top-4 flex h-0.5 bg-brand-200">
        {fields.slice(1).map(({ label, value, error }, index) => <span key={label}
          className={cn('h-full flex-1 origin-left bg-brand-600 transition-transform duration-200 ease-[var(--ease-out)] motion-reduce:transition-none',
            value && !error && fields[index].value && !fields[index].error ? 'scale-x-100' : 'scale-x-0')}/>)}
      </div>
      <ol className="grid grid-cols-3">
        {fields.map((field) => <TimelineDate key={field.label} {...field} referenceDate={referenceDate} disabled={disabled}/>)}
      </ol>
    </div>
  </section>;
}
