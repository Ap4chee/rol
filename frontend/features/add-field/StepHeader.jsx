import { forwardRef } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/shared/lib/cn';

export const STEPS = ['Działka', 'Uprawa i terminy'];

/** Nagłówek kroku formularza z paskiem postępu; `ref` trafia na tytuł, który dostaje fokus po zmianie kroku. */
export const StepHeader = forwardRef(function StepHeader({ step, direction }, stepHeading) {
  return <div className="mb-5 flex flex-col gap-4 sm:mb-6 md:flex-row md:items-end md:justify-between md:gap-8">
    <div key={`head-${step}`} className={cn('min-w-0', direction && 'animate-in fade-in-0 duration-200 ease-[var(--ease-out)] motion-reduce:animate-none')}>
      <p className="eyebrow">Krok {step + 1} z {STEPS.length}</p>
      <h2 ref={stepHeading} tabIndex={-1} className="mt-1 font-display text-[22px] font-semibold tracking-tight outline-none sm:text-[24px]">
        {step === 0 ? 'Gdzie jest pole?' : 'Co rośnie na polu?'}
      </h2>
      <p className="mt-1 text-[13.5px] leading-snug text-neutral-500">
        {step === 0 ? 'Wyszukaj adres lub numer działki, a potem kliknij pole na mapie.'
          : 'Wybierz uprawę. Terminy sezonu są opcjonalne.'}
      </p>
    </div>
    {/* postęp: dwa odcinki z podpisami; bieżący i ukończone wypełnione */}
    <ol aria-label="Kroki formularza" className="grid w-full shrink-0 grid-cols-2 gap-2 md:w-80">
      {STEPS.map((label, index) => <li key={label} aria-current={step === index ? 'step' : undefined} className="min-w-0">
        <span aria-hidden className="block h-1 overflow-hidden rounded-full bg-neutral-200">
          <span className={cn('block h-full origin-left rounded-full bg-brand-600 transition-transform duration-300 ease-[var(--ease-out)] motion-reduce:transition-none',
            step >= index ? 'scale-x-100' : 'scale-x-0')}/>
        </span>
        <span className={cn('mt-2 flex items-center gap-1.5 text-[12.5px] font-medium',
          step === index ? 'text-brand-900' : step > index ? 'text-neutral-700' : 'text-neutral-400')}>
          {step > index ? <Check aria-hidden className="size-3.5 text-brand-600"/> : <span className="num">{index + 1}.</span>}
          <span className="truncate">{label}</span>
        </span>
      </li>)}
    </ol>
  </div>;
});
