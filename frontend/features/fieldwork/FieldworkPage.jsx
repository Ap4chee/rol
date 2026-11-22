import { useState } from 'react';
import { Check, Plus } from 'lucide-react';
import { fieldTabHref } from '@/app/router';
import { addDays, today } from '@/shared/format/date';
import { capitalize } from '@/shared/format/text';
import { ART_SHADOW, cropImage } from '@/shared/assets';
import { Button } from '@/shared/ui/button';
import { Eyebrow } from '@/shared/ui/card';
import { Table, TBody, TD, TH, THead, TR } from '@/shared/ui/table';
import { cn } from '@/shared/lib/cn';
import { fieldworkQuery, mainObstacle, OPERATIONS, windowText } from './logic.js';
import { DayHead, Legend, opImage, RatingCell, STICKY } from './PlanParts.jsx';
import { usePlans } from './usePlans.js';

/** Dni planu, zanim przyjdzie pierwsza odpowiedź serwera: tydzień od dziś. */
const PLAN_DAYS = 7;

/** Wybór pracy jako kafelki z ilustracją; pod nazwą liczba pól z dobrym oknem (przyciski przełączane, aria-pressed). */
function OperationPicker({ value, onChange, ready }) {
  return <div role="group" aria-label="Rodzaj pracy" className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
    {OPERATIONS.map((entry) => {
      const active = entry.key === value;
      const good = ready.filter((plan) => plan.windows[entry.key]).length;
      return <button key={entry.key} type="button" aria-pressed={active} onClick={() => onChange(entry.key)}
        className={cn('flex items-center gap-3 rounded-xl p-2.5 pr-3 text-left ring-1 ring-inset transition-[background-color,box-shadow] duration-150',
          active ? 'bg-brand-50 ring-2 ring-brand-600' : 'bg-white ring-black/[0.08] hover:bg-neutral-50 hover:ring-black/15')}>
        <img src={opImage(entry)} alt="" width="56" height="56" decoding="async" className="size-12 shrink-0 object-contain md:size-14"/>
        <span className="min-w-0">
          <span className={cn('block text-[14px] font-semibold leading-tight', active ? 'text-brand-800' : 'text-neutral-900')}>{entry.label}</span>
          <span className="num mt-1 block text-[12px] leading-tight text-neutral-500">
            {ready.length ? `z oknem: ${good} z ${ready.length}` : 'liczę…'}</span>
        </span>
      </button>;
    })}
  </div>;
}

/** Plan prac dla wszystkich zapisanych pól: wybrana praca, pole × dzień i najlepsze okno dla każdego pola. */
export function FieldworkPage({ fields, onAdd }) {
  const [op, setOp] = useState('traffic');
  const queries = fields.map((field) => fieldworkQuery(field.report));
  const plans = usePlans(queries);
  const ready = queries.map((query) => plans[query]).filter((plan) => plan?.status === 'ok');
  const dates = ready[0]?.days.map((day) => day.date) ?? Array.from({ length: PLAN_DAYS }, (_, i) => addDays(today(), i));
  const label = OPERATIONS.find((entry) => entry.key === op).label.toLowerCase();

  if (!fields.length) return <div className="mx-auto flex max-w-[460px] flex-col items-center py-16 text-center">
    <img src="/design/praca-wjazd.png" alt="" width="200" height="200" decoding="async" className={cn('size-44', ART_SHADOW)}/>
    <h1 className="mt-5 font-display text-[28px] font-semibold tracking-tight">Plan prac</h1>
    <p className="mt-3 text-[15px] leading-relaxed text-neutral-600">Dodaj pole, a pokażemy, w które dni da się na nim pracować.</p>
    <Button size="lg" className="mt-8" icon={<Plus/>} onClick={onAdd}>Dodaj pole</Button>
  </div>;

  return <div className="flex flex-col gap-8">
    {/* pas krajobrazu (deszcz → ciągnik w polu → słońce) po prawej, lewym brzegiem rozmywa się w tle; w wąskim widoku znika */}
    <header className="relative isolate">
      <img src="/design/plan-pas.webp" alt="" width="1000" height="207" decoding="async"
        className="pointer-events-none absolute -right-2 top-1/2 -z-10 hidden w-[54%] max-w-[620px] -translate-y-1/2 [mask-image:linear-gradient(to_right,transparent,#000_28%)] lg:block"/>
      <Eyebrow>7 dni od dziś</Eyebrow>
      <h1 className="mt-2 font-display text-[28px] font-semibold leading-[1.05] tracking-tight md:text-[34px]">Plan prac</h1>
      <p className="mt-3 max-w-[68ch] text-[15px] leading-relaxed text-neutral-600 lg:max-w-[46%]">
        Kiedy na którym polu da się wjechać, siać, pryskać i nawozić. Oceny wynikają z prognozy pogody, gleby i uprawy każdego pola.</p>
    </header>
    <OperationPicker value={op} onChange={setOp} ready={ready}/>
    <section aria-label={`Plan: ${label}`}>
      <Table scroll minWidth={760}>
        <THead><TR>
          <TH className={cn(STICKY, 'w-[200px]')}>Pole</TH>
          {dates.map((date) => <DayHead key={date} date={date}/>)}
          <TH className="w-[180px]">Najlepsze okno</TH>
        </TR></THead>
        <TBody>{fields.map((field, i) => {
          const plan = plans[queries[i]];
          const crop = cropImage(field.report.crop.key);
          return <TR key={field.id}>
            <TD className={cn(STICKY, 'align-middle')}>
              <span className="flex min-w-0 items-center gap-2.5">
                {crop ? <img src={crop} alt="" width="40" height="40" decoding="async" className="size-9 shrink-0 object-contain"/>
                  : <span aria-hidden className="size-9 shrink-0"/>}
                <span className="min-w-0">
                  <a href={fieldTabHref(field.id, 'prace')} className="block truncate font-medium text-neutral-900 hover:text-brand-700 hover:underline">
                    {field.name}</a>
                  <span className="block truncate text-[12px] text-neutral-500">
                    {field.report.crop.name}{plan?.soil_assumed && ', gleba umowna'}</span>
                </span>
              </span>
            </TD>
            {!queries[i] ? <TD colSpan={8} className="align-middle text-[13px] text-neutral-500">Brak położenia pola w raporcie.</TD>
              : !plan ? <>{dates.map((date) => <TD key={date} className="align-middle"><span className="mx-auto block size-8 animate-pulse rounded-lg bg-neutral-100"/></TD>)}<TD/></>
                : plan.status !== 'ok' ? <TD colSpan={8} className="align-middle text-[13px] text-neutral-500">{plan.reason}</TD>
                  : <>
                    {plan.days.map((day) => <TD key={day.date} className="text-center align-middle"><RatingCell value={day[op]}/></TD>)}
                    <TD className="align-middle text-[13px] leading-snug">
                      {windowText(plan.windows[op])
                        ? <span className="num inline-flex items-center gap-1.5 font-semibold text-ok-ink">
                          <Check aria-hidden className="size-3.5" strokeWidth={2.75}/>{windowText(plan.windows[op])}</span>
                        : <span className="text-neutral-500">{capitalize(mainObstacle(plan.days, op))}</span>}
                    </TD>
                  </>}
          </TR>;
        })}</TBody>
      </Table>
      <Legend/>
    </section>
  </div>;
}
