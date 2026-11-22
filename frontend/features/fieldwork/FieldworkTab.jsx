import { CloudRain, Layers, Wind } from 'lucide-react';
import { PLAN_HREF } from '@/app/router';
import { dateText, today } from '@/shared/format/date';
import { number } from '@/shared/format/number';
import { ART_SHADOW } from '@/shared/assets';
import { capitalize } from '@/shared/format/text';
import { Note } from '@/shared/ui/note';
import { Section } from '@/shared/ui/section';
import { Table, TBody, TD, TH, THead, TR } from '@/shared/ui/table';
import { cn } from '@/shared/lib/cn';
import { fieldworkQuery, mainObstacle, OPERATIONS, windowText } from './logic.js';
import { DayHead, Legend, Loading, Notes, OperationLabel, opImage, RatingCell, STICKY, WeekStrip } from './PlanParts.jsx';
import { usePlans } from './usePlans.js';

const WEATHER_ROWS = [
  ['Opad', CloudRain, (day) => (day.rain_mm == null ? '—' : `${number(day.rain_mm, 1)} mm`),
    (day) => (day.rain_mm >= 1 ? 'font-medium text-water-700' : '')],
  ['Wiatr maks.', Wind, (day) => (day.wind_max_kmh == null ? '—' : `${number(day.wind_max_kmh)} km/h`)],
  ['Wierzch gleby', Layers, (day) => (day.surface_fc_pct == null ? '—' : `${number(day.surface_fc_pct)}%`)],
];

/** Werdykt tygodnia dla jednej pracy: najlepsze okno albo najlepsza ocena w tygodniu i główna przeszkoda. */
function OperationCard({ plan, op }) {
  const window = windowText(plan.windows[op.key]);
  const off = plan.days.every((day) => day[op.key].rating === 'off');
  const unknown = !window && !off && plan.days.every((day) => ['unknown', 'off'].includes(day[op.key].rating));
  const caution = !window && plan.days.some((day) => day[op.key].rating === 'caution');
  const title = window ?? (off ? 'Nie w tym okresie' : unknown ? 'Brak danych' : caution ? 'Tylko ostrożnie' : 'Brak dobrego okna');
  const tone = window ? 'text-ok-ink' : off || unknown ? 'text-neutral-500' : caution ? 'text-watch-ink' : 'text-severe-ink';
  return <li className="surface flex flex-col p-4">
    <img src={opImage(op)} alt="" width="80" height="80" decoding="async" className={cn('-ml-1 -mt-1 size-[72px] object-contain', ART_SHADOW)}/>
    <h3 className="mt-2 text-[14.5px] font-semibold text-neutral-900">{op.label}</h3>
    <p className={cn('mt-0.5 text-[15px] font-semibold leading-snug', window && 'num', tone)}>{title}</p>
    <p className="mt-1 text-[12.5px] leading-snug text-neutral-500">
      {window ? 'Najdłuższy ciąg dobrych dni' : capitalize(mainObstacle(plan.days, op.key))}</p>
    <WeekStrip days={plan.days} op={op.key}/>
  </li>;
}

/** Plan na 7 dni dla jednego pola: najpierw werdykt dla każdej pracy, potem dzień po dniu z pogodą, z której wynikają oceny. */
function FieldPlan({ plan }) {
  return <>
    <div className="@container">
      <ul className="grid grid-cols-2 gap-3 @3xl:grid-cols-4">
        {OPERATIONS.map((op) => <OperationCard key={op.key} plan={plan} op={op}/>)}
      </ul>
    </div>
    <h3 className="mt-10 mb-2 text-[15px] font-semibold text-neutral-900">Dzień po dniu</h3>
    <Table scroll minWidth={680}>
      <THead><TR>
        <TH className={cn(STICKY, 'w-[170px] align-bottom')}>Praca</TH>
        {plan.days.map((day) => <DayHead key={day.date} date={day.date} day={day}/>)}
      </TR></THead>
      <TBody>
        {OPERATIONS.map((op) => <TR key={op.key}>
          <TD className={cn(STICKY, 'align-middle')}><OperationLabel op={op}/></TD>
          {plan.days.map((day) => <TD key={day.date} className="text-center align-middle">
            <RatingCell value={day[op.key]}/></TD>)}
        </TR>)}
        {WEATHER_ROWS.map(([label, Icon, format, emphasis], i) => <TR key={label}
          className={cn('bg-neutral-50/70 text-[12.5px] text-neutral-500', i === 0 && 'border-t-2 border-black/[0.06]')}>
          <TD className={cn(STICKY, 'bg-neutral-50 align-middle')}>
            <span className="flex items-center gap-2.5 pl-2"><Icon aria-hidden className="size-4 text-neutral-400" strokeWidth={2}/>{label}</span></TD>
          {plan.days.map((day) => <TD key={day.date} className={cn('num whitespace-nowrap text-center align-middle', emphasis?.(day))}>
            {format(day)}</TD>)}
        </TR>)}
      </TBody>
    </Table>
    <Legend/>
    {/* tylko braki danych (gleba umowna, luka w opadzie); stałych uwag o ograniczeniach planu serwer już nie wysyła */}
    <Notes notes={plan.notes}/>
  </>;
}

/** Zakładka „Prace polowe” w raporcie pola: zawsze od dziś (prognoza), niezależnie od daty raportu. */
export function FieldworkTab({ report }) {
  const query = fieldworkQuery(report);
  const plan = usePlans([query])[query];
  const historical = report.analysis_date < today();
  return <Section title="Plan prac na 7 dni"
    lead={historical ? `Od dziś, z bieżącej prognozy. Nie wchodzi do raportu na ${dateText(report.analysis_date)}.`
      : `Kiedy warunki sprzyjają pracom w polu (uprawa: ${report.crop.name.toLowerCase()}).`}
    aside={<a href={PLAN_HREF} className="text-[13.5px] font-medium text-brand-700 underline decoration-brand-300 underline-offset-2 hover:decoration-brand-700">
      Plan wszystkich pól</a>}>
    {!query ? <Note section={{ status: 'no_data', reason: 'Raport nie ma położenia pola, więc nie ma dla czego pobrać prognozy.' }}/>
      : !plan ? <Loading text="Pobieram prognozę i oceniam dni…"/>
        : plan.status !== 'ok' ? <Note section={plan}/> : <FieldPlan plan={plan}/>}
  </Section>;
}
