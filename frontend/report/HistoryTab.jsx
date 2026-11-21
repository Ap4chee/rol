import { dateText, number, seasonMonths } from '../model.js';
import { Note } from '../ui.jsx';
import { Card } from '@/components/ui/card';
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

/** Zakładka „Historia”: dni niedoboru w kolejnych sezonach, okres krytyczny i miniony sezon. */
export function HistoryTab({ report }) {
  const history = report.history;
  const last = report.water_status.last_season;
  const critical = seasonMonths(report.crop);
  const seasons = history.seasons ?? [];
  return <div className="flex flex-col gap-14">
    <Section title="Czy niedobór się powtarza?" lead="Dni niedoboru w okresie krytycznym uprawy, sezon po sezonie.">
      <Note section={history}/>
      {(seasons.length > 0 || critical.length > 0) && <Card className="p-5 md:p-6">
        {seasons.length > 0 && <SeasonChart history={history} seasons={seasons}/>}
        {critical.length > 0 && <CriticalPeriod months={critical} crop={report.crop} className={seasons.length > 0 ? 'mt-8' : undefined}/>}
      </Card>}
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

/** Słupki dni niedoboru w okresie krytycznym, sezon po sezonie (wysokość względem największej wartości). */
function SeasonChart({ history, seasons }) {
  const max = Math.max(1, ...seasons.map((season) => season.stress_days_critical));
  const summary = 'Dni niedoboru w okresie krytycznym, sezon po sezonie: '
    + seasons.map((season) => `${season.season}${season.complete ? '' : ' (sezon w trakcie)'}: ${season.stress_days_critical}`).join(', ') + '.';
  return <figure>
    <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
      {history.seasons_total ? <Stat size="lg" label="Sezony z niedoborem" hint="ostatnie pełne sezony"
        value={measure(number(history.seasons_with_stress), `z ${history.seasons_total}`)}/> : null}
      <SeasonLegend/>
    </div>
    <div role="img" aria-label={summary} className="mt-7">
      <div className="grid h-44 auto-cols-fr grid-flow-col gap-1 sm:gap-2">
        {seasons.map((season, i) => <SeasonBar key={season.season} season={season} max={max} delay={Math.round(30 * i ** 0.9)}/>)}
      </div>
      <div className="h-px bg-neutral-300"/>
      <div className="mt-2 grid auto-cols-fr grid-flow-col gap-1 sm:gap-2">
        {seasons.map((season) => <SeasonLabel key={season.season} season={season}/>)}
      </div>
    </div>
    {seasons.some((season) => !season.complete) && <figcaption className="mt-3 text-[12px] text-neutral-500">* sezon w trakcie</figcaption>}
  </figure>;
}

/** Kolumna sezonu: cały pas kolumny reaguje na kursor i pokazuje dokładną wartość w dymku. */
function SeasonBar({ season, max, delay }) {
  const days = season.stress_days_critical;
  const height = `max(${days > 0 ? 3 : 2}px, ${100 * days / max}%)`;
  const fill = season.stressed ? 'bg-moderate' : days > 0 ? 'bg-neutral-300' : 'bg-neutral-200';
  const tip = <>
    <span className="num font-semibold">{days}</span> {days === 1 ? 'dzień' : 'dni'} niedoboru
    <span className="block font-normal text-white/60">sezon {season.season}{season.complete ? '' : ', w trakcie'}</span>
  </>;
  return <Tooltip label={tip}>
    <div className="relative h-full rounded-md transition-[background-color] duration-150 ease-out hover:bg-black/[0.035]">
      <div className="absolute inset-x-0 bottom-0 top-6 mx-auto max-w-6">
        <span className={cn('bar-grow absolute inset-x-0 bottom-0 rounded-t-[4px]', fill)} style={{ height, animationDelay: `${delay}ms` }}/>
        <span className={cn('num absolute -inset-x-2 text-center text-[11px] leading-none motion-safe:animate-[chart-fade_360ms_var(--ease-out)_both]',
          season.stressed ? 'font-medium text-neutral-800' : 'text-neutral-400')}
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
    <span className="inline-flex items-center gap-1.5"><span aria-hidden className="size-2 rounded-[2px] bg-moderate"/>sezon z niedoborem</span>
    <span className="inline-flex items-center gap-1.5"><span aria-hidden className="size-2 rounded-[2px] bg-neutral-300"/>bez niedoboru</span>
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
