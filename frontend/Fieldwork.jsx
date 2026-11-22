import { useEffect, useState } from 'react';
import { CalendarDays, Check, CircleHelp, CloudRain, Layers, Minus, Plus, TriangleAlert, Wind, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Eyebrow } from '@/components/ui/card';
import { TONE } from '@/components/ui/status';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { ART_SHADOW, CROP_IMAGES, weatherIcon } from './Dashboard.jsx';
import { dayName, fieldworkQuery, mainObstacle, OPERATIONS, shortDate, windowText } from './fieldwork.js';
import { dateText, fieldTabHref, number, today } from './model.js';
import { api, Note } from './ui.jsx';
import { Section } from './report/shared.jsx';

const RATINGS = {
  good: { label: 'Dobre warunki', tone: 'ok', Icon: Check },
  caution: { label: 'Ostrożnie', tone: 'watch', Icon: TriangleAlert },
  avoid: { label: 'Unikaj', tone: 'severe', Icon: X },
  unknown: { label: 'Brak danych', tone: 'unknown', Icon: CircleHelp },
  off: { label: 'Nie w tym okresie', tone: null, Icon: Minus },
};
// pierwsza kolumna zostaje na miejscu, gdy tabela przewija się w poziomie (telefon)
const STICKY = 'sticky left-0 z-10 bg-white';
const capitalize = (text) => (text ? text[0].toUpperCase() + text.slice(1) : text);
// ilustracja pracy: ciągnik z narzędziem na kawałku pola (static/design/praca-*.png)
const opImage = (op) => `/design/praca-${op.image}.png`;

/** Plany z /api/fieldwork dla listy zapytań (jedno pole albo wszystkie), pobierane równolegle: zapytanie → odpowiedź. */
function usePlans(queries) {
  const key = [...new Set(queries.filter(Boolean))].join('|');
  const [plans, setPlans] = useState({});
  useEffect(() => {
    const controller = new AbortController();
    for (const query of key ? key.split('|') : []) {
      api('/api/fieldwork?' + query, { signal: controller.signal })
        .then((data) => setPlans((state) => ({ ...state, [query]: data })))
        .catch((error) => {
          if (!controller.signal.aborted) setPlans((state) => ({ ...state, [query]: { status: 'error', reason: error.message } }));
        });
    }
    return () => controller.abort();
  }, [key]);
  return plans;
}

/** Ocena dnia: kolorowy kafelek z ikoną (kolor nie jest jedynym nośnikiem), powód w dymku i dla czytnika ekranu. */
function RatingCell({ value }) {
  const rating = RATINGS[value.rating] ?? RATINGS.unknown;
  const tone = rating.tone && TONE[rating.tone];
  return <Tooltip label={`${rating.label}: ${value.reason}`}>
    <span className={cn('mx-auto grid size-8 place-items-center rounded-lg', tone ? cn(tone.bg, tone.text) : 'text-neutral-300')}>
      <rating.Icon aria-hidden className="size-4" strokeWidth={2.25}/>
      <span className="sr-only">{rating.label}: {value.reason}</span>
    </span>
  </Tooltip>;
}

/** Tydzień jednej pracy jako pasek 7 odcinków w kolorach ocen (skrót wzrokowy; to samo jest w tabeli i opisie karty). */
function WeekStrip({ days, op }) {
  return <div aria-hidden className="mt-auto pt-4">
    <div className="flex gap-1">{days.map((day) => {
      const tone = TONE[RATINGS[day[op].rating]?.tone];
      return <span key={day.date} className={cn('h-1.5 flex-1 rounded-full', tone ? tone.dot : 'bg-neutral-200')}/>;
    })}</div>
    <div className="mt-1.5 flex justify-between text-[10.5px] text-neutral-400">
      <span>dziś</span><span>{dayName(days.at(-1).date, today())}</span></div>
  </div>;
}

/** Legenda pod tabelą (poza przewijanym obszarem, żeby na telefonie nie uciekała w bok) i dopiski. */
function Legend({ children }) {
  return <div className="mt-3 space-y-1.5 text-[12px] text-neutral-500">
    <p className="flex flex-wrap gap-x-4 gap-y-1.5">
      {Object.entries(RATINGS).filter(([key]) => key !== 'unknown').map(([key, rating]) => {
        const tone = rating.tone && TONE[rating.tone];
        return <span key={key} className="flex items-center gap-1.5">
          <span aria-hidden className={cn('grid size-5 place-items-center rounded-md', tone ? cn(tone.bg, tone.text) : 'text-neutral-300')}>
            <rating.Icon className="size-3" strokeWidth={2.5}/></span>{rating.label}</span>;
      })}
    </p>
    {children}
  </div>;
}

const temperature = (value) => (value == null ? '—' : `${number(value)}°`.replace('-', '−'));

/** Nagłówek dnia; z `day` (plan jednego pola) także ikona pogody i temperatura maks. / min. */
function DayHead({ date, day }) {
  const isToday = date === today();
  const [icon, label] = day ? weatherIcon(day.weather_code) : [];
  return <TH className={cn('text-center align-bottom', isToday && 'text-brand-700')}>
    <span className={cn('block font-semibold', isToday ? 'text-brand-700' : 'text-neutral-700')}>{dayName(date, today())}</span>
    <span className="num block font-normal">{shortDate(date)}</span>
    {day && <>
      {/* brak kodu pogody: kreska zamiast obrazka, żeby nie udawać zachmurzenia */}
      <span className="mt-1 flex h-10 items-center justify-center">
        {icon ? <img src={`/design/pogoda-${icon}.png`} alt={label} title={label} width="40" height="40" decoding="async"
          className="size-9 object-contain"/> : <span role="img" aria-label={label} className="text-neutral-400">—</span>}</span>
      <span className="num block whitespace-nowrap text-[13px] font-semibold text-neutral-900">{temperature(day.temperature_max_c)}
        <span className="font-normal text-neutral-400"> / {temperature(day.temperature_min_c)}</span></span>
    </>}
  </TH>;
}

/** Ilustracja i nazwa pracy w pierwszej kolumnie tabeli. */
function OperationLabel({ op }) {
  return <span className="flex items-center gap-2.5">
    <img src={opImage(op)} alt="" width="40" height="40" decoding="async" className="size-9 shrink-0 object-contain"/>
    <span className="font-medium leading-tight text-neutral-900">{op.label}</span>
  </span>;
}

function Notes({ notes }) {
  return notes?.length > 0 && <ul className="mt-6 max-w-[80ch] list-disc space-y-1 pl-5 text-[12.5px] leading-relaxed text-neutral-500">
    {notes.map((note) => <li key={note}>{note}</li>)}</ul>;
}

function Loading({ text }) {
  return <p role="status" className="flex items-center gap-2 py-6 text-[13.5px] text-neutral-500">
    <CalendarDays aria-hidden className="size-4 animate-pulse"/>{text}</p>;
}

// ---------- jedno pole (zakładka raportu) ----------

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
    <Legend>
      <p>Najedź na kafelek, żeby zobaczyć powód.</p>
      <span className="block">Wierzch gleby: wilgotność warstwy 0–10 cm rano w % pojemności polowej (model z opadu i parowania).
        {plan.soil_assumed && ' Gleba umowna, bo raport nie ma danych o glebie.'}</span>
    </Legend>
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
    aside={<a href="#plan" className="text-[13.5px] font-medium text-brand-700 underline decoration-brand-300 underline-offset-2 hover:decoration-brand-700">
      Plan wszystkich pól</a>}>
    {!query ? <Note section={{ status: 'no_data', reason: 'Raport nie ma położenia pola, więc nie ma dla czego pobrać prognozy.' }}/>
      : !plan ? <Loading text="Pobieram prognozę i oceniam dni…"/>
        : plan.status !== 'ok' ? <Note section={plan}/> : <FieldPlan plan={plan}/>}
  </Section>;
}

// ---------- wszystkie pola (osobna strona) ----------

const addDays = (iso, n) => new Date(Date.parse(iso + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);

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
  const dates = ready[0]?.days.map((day) => day.date) ?? Array.from({ length: 7 }, (_, i) => addDays(today(), i));
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
          const crop = CROP_IMAGES[field.report.crop.key];
          return <TR key={field.id}>
            <TD className={cn(STICKY, 'align-middle')}>
              <span className="flex min-w-0 items-center gap-2.5">
                {crop ? <img src={`/design/${crop}.png`} alt="" width="40" height="40" decoding="async" className="size-9 shrink-0 object-contain"/>
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
