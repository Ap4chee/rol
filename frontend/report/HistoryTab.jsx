import { dateText, number, seasonMonths } from '../model.js';
import { Note, Paragraphs, statusFill } from '../ui.jsx';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Card } from '@/components/ui/card';
import { Meter } from '@/components/ui/meter';
import { Stat, StatGrid } from '@/components/ui/stat';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { MONTHS, Section } from './shared.jsx';

/** Duża liczba z jednostką: jednostka mniejsza i jaśniejsza (np. 285 mm, 88%), twarda spacja przed jednostką. */
function measure(value, unit) {
  return <>{value}<span className="text-[0.6em] font-normal text-neutral-500">{unit === '%' ? unit : <>&nbsp;{unit}</>}</span></>;
}

// Etykieta liczby, która może zająć dwie linie (Stat domyślnie ucina tekst).
const wrapping = (text) => <span className="whitespace-normal">{text}</span>;

const dni = (n) => (n === 1 ? 'dzień' : 'dni');

// rząd dużych liczb: na telefonie dwie kolumny zamiast długiej listy, szerzej jeden rząd
const STATS = 'grid grid-cols-2 gap-x-6 gap-y-5 sm:flex sm:flex-wrap sm:gap-x-12';

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Zakładka „Historia”: dzień analizy na tle lat, dni niedoboru w kolejnych sezonach, okres krytyczny i miniony sezon. */
export function HistoryTab({ report, intro = false }) {
  const history = report.history;
  const last = report.water_status.last_season;
  const critical = seasonMonths(report.crop);
  const seasons = history.seasons ?? [];
  return <div className="flex flex-col gap-14">
    {history.same_day_years > 0 && <Section title="Na tle poprzednich lat"
      lead="Ten sam bilans wodny policzony dla tego samego dnia roku w poprzednich latach.">
      <SameDay history={history} water={report.water_status} day={report.water_status.last_data_day ?? report.analysis_date}/>
    </Section>}
    <Section title="Niedobór wody w poprzednich sezonach">
      <Note section={history}/>
      {(seasons.length > 0 || critical.length > 0) && <Card className="p-5 md:p-6">
        {seasons.length > 0 && <SeasonChart history={history} seasons={seasons} intro={intro}/>}
        {critical.length > 0 && <CriticalPeriod months={critical} crop={report.crop} className={seasons.length > 0 ? 'mt-7 border-t border-black/[0.07] pt-5' : undefined}/>}
      </Card>}
      {history.text?.length > 0 && <Accordion type="single" collapsible className="mt-3 border-y border-black/[0.07]">
        <AccordionItem value="history">
          <AccordionTrigger>Szczegóły porównania</AccordionTrigger>
          <AccordionContent className="max-w-[72ch] text-[13.5px]"><Paragraphs lines={history.text}/></AccordionContent>
        </AccordionItem>
      </Accordion>}
    </Section>
    {last && <Section title={`Miniony sezon ${last.season}`}>
      {/* etykiety mają różną liczbę linii, więc liczby dosuwamy do dołu komórek, żeby stały w jednej linii */}
      <StatGrid className="[&>*]:flex [&>*]:flex-col [&>*]:justify-between [&>*]:gap-1">
        <Stat label="Opad" value={measure(number(last.rain_mm), 'mm')}/>
        <Stat label={wrapping('Zużycie wody przez uprawę')} value={measure(number(last.etc_mm), 'mm')}/>
        <Stat label={wrapping('Dni niedoboru w okresie krytycznym')} value={number(last.stress_days_critical)}/>
        <Stat label={wrapping('Największe wyczerpanie zapasu')} value={measure(number(last.max_depletion_pct_taw), '%')}/>
      </StatGrid>
    </Section>}
  </div>;
}

/** Zapas wody w dniu analizy na tle tego samego dnia w poprzednich latach (pasek: ten dzień, kreska: mediana lat). */
function SameDay({ history, water, day }) {
  // backend podaje wyczerpanie zapasu (% wody dostępnej); rolnikowi pokazujemy to, co zostało
  const now = 100 - history.same_day_current_pct;
  const usual = 100 - history.same_day_median_pct;
  return <Card className="flex flex-wrap items-end gap-x-16 gap-y-6 p-5 md:p-6">
    <div className={STATS}>
      <Stat size="lg" label={`Zapas wody ${dateText(day)}`} value={measure(number(now), '%')}
        hint={`zwykle tego dnia ${number(usual)}%`}/>
      <Stat size="lg" label="Suchsze lata" hint="mniejszy zapas tego samego dnia"
        value={measure(number(history.same_day_drier_years), `z ${history.same_day_years}`)}/>
    </div>
    <div className="min-w-60 max-w-[440px] flex-1 pb-0.5">
      <Meter value={now} marker={usual} color={statusFill(water)}
        label={`Zapas wody: ${number(now)}%, zwykle tego dnia ${number(usual)}%`}/>
      <p className="num mt-2.5 inline-flex items-center gap-1.5 text-[12.5px] text-neutral-500">
        <span aria-hidden className="h-3 w-[2px] rounded-full bg-neutral-900"/>zwykle, mediana z {history.same_day_years} lat
      </p>
    </div>
  </Card>;
}

/** Słupki dni niedoboru w okresie krytycznym, sezon po sezonie (wysokość względem największej wartości). */
function SeasonChart({ history, seasons, intro }) {
  const max = Math.max(1, ...seasons.map((season) => season.stress_days_critical));
  const summary = 'Dni niedoboru w okresie krytycznym, sezon po sezonie: '
    + seasons.map((season) => `${season.season}${season.complete ? '' : ' (sezon w trakcie)'}: ${season.stress_days_critical}`
      + (season.severe_days_critical ? `, w tym silnego ${season.severe_days_critical}` : '')).join('; ') + '.';
  const past = seasons.filter((season) => season.complete);
  const typical = past.length ? Math.round(median(past.map((season) => season.stress_days_critical))) : null;
  const worst = past.reduce((a, s) => (s.stress_days_critical > (a?.stress_days_critical ?? 0) ? s : a), null);
  return <figure>
    <div className={STATS}>
      {history.seasons_total ? <Stat size="lg" label="Sezony z niedoborem" hint="ostatnie pełne sezony"
        value={measure(number(history.seasons_with_stress), `z ${history.seasons_total}`)}/> : null}
      {typical != null && <Stat size="lg" label="Typowy sezon" hint="mediana dni niedoboru"
        value={measure(number(typical), dni(typical))}/>}
      {worst && <Stat size="lg" label="Najgorszy sezon" value={worst.season}
        hint={`${worst.stress_days_critical} ${dni(worst.stress_days_critical)} niedoboru, najdłużej ${worst.longest_stress_run_days} z rzędu`}/>}
    </div>
    <figcaption className="mt-8 flex flex-wrap items-baseline justify-between gap-x-8 gap-y-2">
      <span className="text-[13px] font-medium text-neutral-800">Dni niedoboru wody w okresie krytycznym</span>
      {/* jedna seria nie potrzebuje legendy; druga (silny niedobór) pojawia się tylko, gdy wystąpił */}
      {seasons.some((season) => season.severe_days_critical > 0) && <SeasonLegend/>}
    </figcaption>
    <div role="img" aria-label={summary} className="mt-2">
      <div className="grid h-52 auto-cols-fr grid-flow-col gap-1 sm:gap-2">
        {seasons.map((season, i) => <SeasonBar key={season.season} season={season} max={max} intro={intro} delay={Math.round(30 * i ** 0.9)}/>)}
      </div>
      <div className="h-px bg-neutral-300"/>
      <div className="mt-2 grid auto-cols-fr grid-flow-col gap-1 sm:gap-2">
        {seasons.map((season) => <SeasonLabel key={season.season} season={season}/>)}
      </div>
    </div>
    {seasons.some((season) => !season.complete) && <p className="mt-3 text-[12px] text-neutral-500">* sezon w trakcie</p>}
  </figure>;
}

/** Kolumna sezonu: cały pas kolumny reaguje na kursor i pokazuje dokładną wartość w dymku. */
function SeasonBar({ season, max, delay, intro }) {
  const days = season.stress_days_critical;
  const severe = Math.min(days, season.severe_days_critical ?? 0);
  const run = season.longest_stress_run_days;
  const height = `max(${days > 0 ? 3 : 2}px, ${100 * days / max}%)`;
  const fill = !season.stressed ? (days > 0 ? 'bg-neutral-300' : 'bg-neutral-200') : severe === days ? 'bg-moderate-ink' : 'bg-moderate';
  const tip = <>
    <span className="num font-semibold">{days}</span> {dni(days)} niedoboru
    {severe > 0 && <>, w tym <span className="num font-semibold">{severe}</span> silnego</>}
    {run > 1 && <span className="block">najdłużej {run} dni z rzędu</span>}
    <span className="block font-normal text-white/60">
      sezon {season.season}{season.complete ? '' : ', w trakcie'} · najniższy zapas {number(100 - season.max_depletion_pct_taw)}%
    </span>
  </>;
  return <Tooltip label={tip}>
    <div className="relative h-full rounded-md transition-[background-color] duration-150 ease-out hover:bg-black/[0.035]">
      {/* słupek zajmuje część kolumny: na wąskim ekranie całą, na szerokim połowę, najwyżej 44 px */}
      <div className="absolute inset-x-0 bottom-0 top-6 mx-auto w-full max-w-11 sm:w-1/2">
        {/* słupki rosną tylko przy pierwszym pokazaniu raportu, nie przy każdym powrocie na zakładkę */}
        <span className={cn('absolute inset-x-0 bottom-0 overflow-hidden rounded-t-[4px]', intro && 'bar-grow', fill)} style={{ height, animationDelay: `${delay}ms` }}>
          {/* silny niedobór: ciemniejsza dolna część słupka, oddzielona 2 px tła */}
          {severe > 0 && severe < days && <span className="absolute inset-x-0 bottom-0 bg-moderate-ink shadow-[0_-2px_0_var(--color-card)]"
            style={{ height: `${100 * severe / days}%` }}/>}
        </span>
        <span className={cn('num absolute -inset-x-2 text-center text-[11px] leading-none',
          intro && 'motion-safe:animate-[chart-fade_360ms_var(--ease-out)_both]',
          season.stressed ? 'font-medium text-neutral-800' : 'text-neutral-500')}
          style={{ bottom: `calc(${height} + 6px)`, animationDelay: `${delay + 200}ms` }}>{days}</span>
      </div>
    </div>
  </Tooltip>;
}

/** Podpis pod słupkiem; na wąskim ekranie rok skrócony („’19”), gwiazdka przy sezonie w trakcie. */
function SeasonLabel({ season }) {
  const year = /^\d{4}$/.test(season.season);
  return <span className="num text-center text-[11px] leading-none text-neutral-500">
    {year ? <><span className="sm:hidden">’{season.season.slice(2)}</span><span className="hidden sm:inline">{season.season}</span></>
      : season.season}{season.complete ? '' : '*'}
  </span>;
}

function SeasonLegend() {
  return <div className="flex items-center gap-4 text-[12px] text-neutral-500">
    <span className="inline-flex items-center gap-1.5"><span aria-hidden className="size-2 rounded-[2px] bg-moderate"/>niedobór</span>
    <span className="inline-flex items-center gap-1.5"><span aria-hidden className="size-2 rounded-[2px] bg-moderate-ink"/>w tym silny</span>
  </div>;
}

/** Okres krytyczny uprawy: daty i ciągłe podświetlenie na pasku 12 miesięcy. */
function CriticalPeriod({ months, crop, className }) {
  const range = crop.critical_from && crop.critical_to
    ? `${dateText(crop.critical_from).slice(0, 5)}–${dateText(crop.critical_to).slice(0, 5)}` : null;
  return <div className={className}>
    <p className="text-[13px] text-neutral-500">Okres krytyczny{range && <span className="num text-neutral-800"> · {range}</span>}</p>
    <ol aria-hidden className="mt-3 grid grid-cols-12">
      {MONTHS.map((month, i) => {
        const on = months.includes(i);
        return <li key={month} className={cn('py-1.5 text-center text-[11.5px] leading-none',
          on ? 'bg-moderate-soft font-semibold text-moderate-ink' : 'text-neutral-400',
          on && !months.includes(i - 1) && 'rounded-l-full', on && !months.includes(i + 1) && 'rounded-r-full')}>{month}</li>;
      })}
    </ol>
  </div>;
}
