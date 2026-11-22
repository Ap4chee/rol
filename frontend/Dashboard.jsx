import { useEffect, useId, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { ArrowRight, ChevronLeft, ChevronRight, CloudRain, Droplet, Droplets, Layers, LoaderCircle, Pencil, Plus, Sprout, Trash2, Waves } from 'lucide-react';
import { SPRING_LAYOUT, SPRING_PRESS } from '@/lib/ease';
import { Button } from '@/components/ui/button';
import { Card, Eyebrow } from '@/components/ui/card';
import { Label, NativeSelect } from '@/components/ui/field';
import { Meter } from '@/components/ui/meter';
import { Segmented } from '@/components/ui/segmented';
import { StatusBadge, StatusDot, TONE } from '@/components/ui/status';
import { NumberTicker } from '@/components/spectrumui/number-ticker';
import { SkeletonReveal } from '@/components/spectrumui/skeleton-reveal';
import { cn } from '@/lib/utils';
import { actionItems, byUrgency, dateText, fieldHref, fieldTabHref, number, today, waterPercent } from './model.js';
import { api, Note, ParcelOutline, Status, statusFill, statusInk, statusTone } from './ui.jsx';

export const CROP_IMAGES = { maize: 'kukurydza', winter_wheat: 'pszenica', spring_barley: 'jeczmien', winter_rapeseed: 'rzepak', grassland: 'laka', potato: 'ziemniaki', sugar_beet: 'burak' };

// Pierwsze wejście bloku: krótko w górę z przezroczystości. Przy ograniczonym ruchu samo przenikanie, bez przesunięcia.
const RISE = 'animate-rise motion-reduce:animate-in motion-reduce:fade-in motion-reduce:fill-mode-both';
// Kaskada kart przy wejściu na pulpit: nierówne odstępy (ms); od siódmej karty bez dalszej zwłoki.
const STAGGER = [0, 50, 90, 120, 145, 165];
const riseDelay = (ms) => ({ animationDelay: `${ms}ms` });
let introPlayed = false;   // wejście pulpitu tylko raz na sesję, nie przy powrocie z raportu

// ---------- pusty pulpit ----------

// Ilustracje 3D (makiety pola z przekrojem gleby) w /design; cień z CSS, bo obrazki mają przezroczyste tło bez cienia
export const ART_SHADOW = 'drop-shadow-[0_10px_14px_rgba(0,0,0,0.12)]';

/** Pusty pulpit: ilustracja, jedno zdanie i przycisk; samo dodawanie pola jest w modalu. */
function EmptyState({ onAdd }) {
  return <div className={cn('mx-auto flex max-w-[460px] flex-col items-center px-2 py-16 text-center md:py-24', RISE)}>
    <img src="/design/pole.webp" alt="" width="360" height="220" decoding="async" className={cn('h-auto w-[300px] md:w-[360px]', ART_SHADOW)}/>
    <h1 className="mt-6 font-display text-[28px] font-semibold leading-[1.05] tracking-tight md:text-[34px]">Dodaj pierwsze pole</h1>
    <p className="mt-3 max-w-[42ch] text-[15px] leading-relaxed text-neutral-600">
      Wpisz numer działki albo wskaż ją na mapie. Sprawdzimy, czy brakuje jej wody i co z tym zrobić.</p>
    <Button size="lg" className="mt-8" icon={<Plus/>} onClick={onAdd} data-tour="add">Dodaj pole</Button>
  </div>;
}

// ---------- pierwszy rzut oka ----------

const BUCKETS = [
  ['severe', 'severe', 'silny niedobór'], ['moderate', 'moderate', 'umiarkowany niedobór'],
  ['watch', 'watch', 'do obserwacji'], ['none', 'ok', 'bez niedoboru'],
];
export const BUCKET_IMAGES = { severe: 'silny', moderate: 'umiarkowany', watch: 'obserwacja', none: 'ok', unknown: 'brak' };

const fieldsOf = (n) => `z ${n} ${n === 1 ? 'pola' : 'pól'}`;
// 2–4 pola (bez 12–14) „potrzebują”; 1 pole i 5+ pól „potrzebuje”
const needs = (n) => (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'potrzebują' : 'potrzebuje');

function leadSentence(total, urgent, unknown) {
  if (urgent) return `${urgent} ${fieldsOf(total)} ${needs(urgent)} teraz uwagi.`;
  // pola bez oceny nie wchodzą do „żadne nie ma niedoboru” (brak danych mówimy wprost)
  const assessed = total - unknown;
  if (!assessed) return `Żadne ${fieldsOf(total)} nie ma oceny wody.`;
  if (unknown) return `Żadne ${assessed === 1 ? 'z 1 ocenionego pola' : `z ${assessed} ocenionych pól`} nie ma teraz niedoboru wody.`;
  return `Żadne ${fieldsOf(total)} nie ma teraz niedoboru wody.`;
}

/** Stan wszystkich pól: zdanie, pasek udziałów i liczba pól w każdym stanie (pola bez oceny osobno, tylko gdy są). */
function Overview({ fields, intro }) {
  const titleId = useId();
  const count = (key) => fields.filter(({ report: { water_status: water } }) => water.status === 'ok' && water.class_key === key).length;
  const buckets = BUCKETS.map(([key, tone, label]) => ({ key, tone, label, count: count(key) }));
  const unknown = fields.length - buckets.reduce((sum, bucket) => sum + bucket.count, 0);
  if (unknown) buckets.push({ key: 'unknown', tone: 'unknown', label: 'bez oceny', count: unknown });
  return <section aria-labelledby={titleId} className={cn('surface relative isolate overflow-hidden px-6 py-7 md:p-8', RISE)}>
    {/* krajobraz wychodzi z prawego górnego rogu karty (przycięty jej krawędzią), lewym i dolnym brzegiem rozmywa się w tle;
        w wąskim pulpicie zasłaniałby zdanie, więc znika */}
    <img src="/design/pulpit-pas.webp" alt="" width="1000" height="236" decoding="async"
      className="pointer-events-none absolute -right-3 -top-3 -z-10 hidden w-[56%] max-w-[620px] [mask-composite:intersect] [mask-image:linear-gradient(to_right,transparent,#000_30%),linear-gradient(to_bottom,#000_62%,transparent)] @3xl/dash:block"/>
    <Eyebrow id={titleId}>Stan wody na polach</Eyebrow>
    <p className="mt-3 font-display text-[26px] font-semibold leading-[1.15] tracking-tight text-balance text-neutral-950 md:text-[30px] @3xl/dash:max-w-[46%]">
      {leadSentence(fields.length, count('severe') + count('moderate'), unknown)}</p>
    {/* udziały stanów w kolejności pilności; pasek wsuwa się raz, przy wejściu */}
    <div aria-hidden className="mt-7 h-2 overflow-hidden rounded-full">
      <div className="flex h-full gap-[3px] animate-in slide-in-from-left-full duration-[600ms] ease-out delay-150 fill-mode-both motion-reduce:animate-none">
        {buckets.filter((bucket) => bucket.count).map((bucket) =>
          <span key={bucket.key} className={cn('h-full min-w-1', TONE[bucket.tone].dot)} style={{ flexGrow: bucket.count }}/>)}
      </div>
    </div>
    <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-5 @xl/dash:grid-flow-col @xl/dash:grid-cols-none @xl/dash:auto-cols-fr">
      {buckets.map((bucket) => <div key={bucket.key} className="flex min-w-0 flex-col-reverse justify-end gap-2">
        <dt className={cn('flex items-center gap-1.5 text-[13px] leading-snug', bucket.count ? 'text-neutral-600' : 'text-neutral-500')}>
          <StatusDot tone={bucket.tone} className={bucket.count ? undefined : 'opacity-40'}/>{bucket.label}</dt>
        <dd className="num text-[36px] font-medium leading-none tracking-tight"
          style={{ color: bucket.count ? TONE[bucket.tone].ink : 'var(--color-neutral-500)' }}>
          <img src={`/design/stan-${BUCKET_IMAGES[bucket.key]}.png`} alt="" width="56" height="56" decoding="async"
            className={cn('mb-3 block size-14', bucket.count ? undefined : 'opacity-35 grayscale')}/>
          {intro ? <NumberTicker value={bucket.count} duration={0.8}/> : bucket.count}</dd>
      </div>)}
    </dl>
  </section>;
}

// ---------- karty pól ----------

// wspólny wygląd kafelków uprawy i sylwetki działki (karta pola, nagłówek raportu)
export const TILE = 'size-11 shrink-0 rounded-xl bg-neutral-50 ring-1 ring-inset ring-black/[0.05]';

/** Kafelek uprawy: ilustracja z /design albo ikona, gdy uprawa jej nie ma. `className` zmienia rozmiar kafelka. */
export function CropTile({ crop, className }) {
  const image = CROP_IMAGES[crop?.key];
  return <span className={cn('grid place-items-center', TILE, className)}>
    {image ? <img src={`/design/${image}.png`} alt="" width="40" height="40" loading="lazy" decoding="async" className="size-[90%] object-contain"/>
      : <Sprout aria-hidden className="size-5 text-brand-600" strokeWidth={1.75}/>}
  </span>;
}

// Stan liczenia raportu na serwerze (app/fields.py): worker liczy raport po dodaniu pola i raz na dobę.
const JOB = { queued: 'W kolejce', running: 'Liczę raport', error: 'Nie udało się policzyć' };
const refreshedText = (iso) => new Intl.DateTimeFormat('pl-PL', {
  day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Warsaw' }).format(new Date(iso));

/** Plakietka liczenia: kręci się, dopóki serwer liczy; przy błędzie podaje powód w podpowiedzi. */
export function JobBadge({ field, className }) {
  if (!JOB[field.job]) return null;
  const failed = field.job === 'error';
  const label = !field.report ? JOB[field.job] : failed ? 'Nie odświeżono' : 'Odświeżam raport';
  return <StatusBadge tone={failed ? 'severe' : 'info'} size="sm" spin={!failed} icon={failed ? undefined : LoaderCircle}
    title={field.error ?? undefined} className={className}>{label}</StatusBadge>;
}

/** Pasek pod kartą: stan raportu po lewej, edycja i usuwanie po prawej (przyciski nie są zagnieżdżone w <a>). */
function CardFooter({ field, onEdit, onDelete }) {
  return <div className="flex items-center justify-end gap-1 border-t border-black/[0.05] bg-neutral-50/70 px-3 py-1.5">
    <div role="status" className="mr-auto min-w-0 truncate pl-1 text-[12px] text-neutral-500">
      {/* karta bez raportu pokazuje stan w treści, więc tu tylko przy odświeżaniu istniejącego raportu */}
      {!field.report ? null : JOB[field.job] ? <JobBadge field={field}/>
        : field.refreshed_at && <>Odświeżono {refreshedText(field.refreshed_at)}</>}
    </div>
    <Button variant="ghost" size="sm" icon={<Pencil/>} aria-label={`Edytuj pole ${field.name}`}
      onClick={() => onEdit(field)} className="text-neutral-600 max-sm:h-9">Edytuj</Button>
    <Button variant="ghost" size="sm" icon={<Trash2/>} aria-label={`Usuń pole ${field.name}`}
      onClick={() => onDelete(field)}
      className="text-neutral-600 hover:bg-severe-soft hover:text-severe-ink max-sm:h-9">Usuń</Button>
  </div>;
}

/** Karta pola, którego pierwszy raport jeszcze się liczy (albo się nie udał): stan zamiast wyniku. */
function PendingFieldCard({ field, style, onEdit, onDelete }) {
  const failed = field.job === 'error';
  return <Card className={cn('flex min-w-0 flex-col overflow-hidden', RISE)} style={style}>
    <a href={fieldHref(field.id)} className="group flex flex-1 flex-col p-5 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-600">
      <div className="flex items-center gap-3">
        <CropTile crop={{ key: field.input.crop }}/>
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-sans text-[15px] font-semibold leading-snug tracking-tight text-neutral-900">{field.name}</h3>
          <p className="mt-0.5 truncate text-[13px] text-neutral-500">{field.input.parcel_id ?? 'Wskazany punkt'}</p>
        </div>
        <ChevronRight aria-hidden className="size-4 shrink-0 text-neutral-300 transition-[color,translate] duration-200 ease-out group-hover:translate-x-0.5 group-hover:text-neutral-500"/>
      </div>
      <div className="mt-5 flex flex-1 flex-col items-start gap-2.5">
        <JobBadge field={field}/>
        <p className="text-[13px] leading-snug text-neutral-500">{failed
          ? `${field.error} Serwer spróbuje ponownie sam.`
          : 'Pobieram pogodę, glebę i zdjęcia satelitarne. Wynik pojawi się tu sam, zwykle w ciągu minuty.'}</p>
      </div>
    </a>
    <CardFooter field={field} onEdit={onEdit} onDelete={onDelete}/>
  </Card>;
}

/** Karta pola: treść jest linkiem do raportu, a u dołu osobny pasek ze stanem raportu, edycją i usuwaniem. */
function FieldCard({ field, style, onEdit, onDelete }) {
  const { report } = field;
  const water = report.water_status;
  const value = waterPercent(water.result);
  const climat = water.climatic_water_balance;
  const hydro = report.hydrology;
  const brook = hydro?.nearest_watercourse_distance_m;
  const retention = report.recommendations?.retention ?? [];
  // retencja wody na tym polu, z raportu; wiersz bez danych jest pomijany zamiast pokazywać zero
  const facts = [
    [Layers, 'Pojemność wodna gleby', water.result &&`${number(water.result.taw_mm)} mm`],
    [CloudRain, `Opad − parowanie, ${climat?.days} dni`, climat && `${number(climat.balance_mm)} mm`.replace('-', '−')],
    [Waves, 'Najbliższy ciek', Number.isFinite(brook) && [hydro.nearest_watercourse_name,
      brook < 1000 ? `${number(brook)} m` : `${number(brook / 1000, 1)} km`].filter(Boolean).join(' · ')],
  ].filter(([, , v]) => v);
  return <Card className={cn('flex min-w-0 flex-col overflow-hidden transition-[border-color,box-shadow] duration-200 ease-out hover:border-black/[0.14] hover:shadow-raised', RISE)} style={style}>
    <a href={fieldHref(field.id)} className="group flex flex-1 flex-col p-5 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-600">
      <div className="flex items-center gap-3">
        <CropTile crop={report.crop}/>
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-sans text-[15px] font-semibold leading-snug tracking-tight text-neutral-900">{field.name}</h3>
          <p className="mt-0.5 truncate text-[13px] text-neutral-500">
            {report.crop.name}{report.parcel?.area_ha != null && <> · <span className="num">{number(report.parcel.area_ha, 2)} ha</span></>}</p>
        </div>
        <ParcelOutline geometry={report.parcel?.geometry} className={cn(TILE, 'p-1')}/>
        <ChevronRight aria-hidden className="size-4 shrink-0 text-neutral-300 transition-[color,translate] duration-200 ease-out group-hover:translate-x-0.5 group-hover:text-neutral-500"/>
      </div>
      {/* kolejność wzroku: 1) stan wody (duża liczba w kolorze stanu), 2) co zrobić, 3) szczegóły drobnym drukiem */}
      <div className="mt-5">
        <div className="flex items-start justify-between gap-3">
          {value != null
            ? <p className="num font-display text-[44px] font-semibold leading-none tracking-tight" style={{ color: statusInk(water) }}>
              {number(value)}<span className="text-[26px]">%</span></p>
            : <p className="font-display text-[22px] font-semibold leading-tight text-neutral-500">Brak oceny</p>}
          <Status water={water} size="sm" className="mt-1 shrink-0"/>
        </div>
        <p className="mt-1.5 flex items-center gap-1.5 text-[13px] text-neutral-500">
          <Droplet aria-hidden className="size-3.5 shrink-0 fill-water-100 text-water-500" strokeWidth={1.75}/>zapasu wody w strefie korzeni</p>
        {/* bez zapasu: powód z raportu (czego brakuje) zamiast pustego paska */}
        {value != null ? <Meter value={value} color={statusFill(water)} label="Zapas wody w strefie korzeni" className="mt-3"/>
          : (water.reason ?? water.headline) && <p className="mt-2 line-clamp-2 text-[13px] leading-snug text-neutral-500">{water.reason ?? water.headline}</p>}
      </div>
      {retention.length > 0 && <div className="mt-4 flex gap-2.5 rounded-xl bg-brand-50 px-3.5 py-3">
        <Droplets aria-hidden className="mt-0.5 size-4 shrink-0 text-brand-600" strokeWidth={1.75}/>
        <div className="min-w-0">
          <p className="text-[12.5px] font-semibold text-brand-700">Co zrobić</p>
          <p className="mt-0.5 line-clamp-2 text-[14px] font-medium leading-snug text-neutral-900">{retention[0].title}</p>
          {retention.length > 1 && <p className="mt-0.5 text-[12.5px] text-neutral-500">i {retention.length - 1} więcej w raporcie</p>}
        </div>
      </div>}
      {/* mt-auto: szczegóły na dole, w jednym rzędzie kart na tej samej wysokości */}
      {facts.length > 0 && <div className="mt-auto pt-4">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 border-t border-neutral-100 pt-3 text-[12.5px]">
          {facts.map(([Icon, label, text]) => <div key={label} className="contents">
            <dt className="flex items-center gap-2 text-neutral-500">
              <Icon aria-hidden className="size-3.5 shrink-0 text-neutral-400" strokeWidth={1.75}/>{label}</dt>
            <dd className="num truncate text-right text-neutral-700" title={text}>{text}</dd>
          </div>)}
        </dl>
      </div>}
    </a>
    <CardFooter field={field} onEdit={onEdit} onDelete={onDelete}/>
  </Card>;
}

// ---------- najbliższe działania ----------

const ACTION_IMAGES = { retention: 'retencja', agrotechnical: 'agrotechnika', irrigation: 'nawadnianie', field_check: 'ogledziny' };
// Wiersz lekko odjeżdża w prawo przy najechaniu (wzór: Nav List Card ze Spectrum UI), sprężyna z małym odbiciem.
const NUDGE = { type: 'spring', bounce: 0.25, duration: 0.3 };

/** Pierwsze działanie dla każdego pola, od najpilniejszego; link prowadzi do zakładki rekomendacji. */
function NextActions({ items, style }) {
  const titleId = useId();
  return <section aria-labelledby={titleId} className={cn('surface p-5', RISE)} style={style}>
    <div className="flex items-baseline justify-between gap-3">
      <h2 id={titleId} className="font-sans text-[15px] font-semibold tracking-tight text-neutral-900">Najbliższe działania</h2>
      {items.length > 0 && <span className="num text-[12.5px] text-neutral-400">{items.length}</span>}
    </div>
    {items.length ? <ul className="-mx-2 mt-3 flex flex-col gap-0.5">{items.map(({ field, action }) => {
      const image = ACTION_IMAGES[action.category];
      return <li key={field.id}>
        <motion.a href={fieldTabHref(field.id, 'rekomendacje')} whileHover={{ x: 2 }} whileTap={{ scale: 0.98 }} transition={NUDGE}
          className="group flex items-start gap-3 rounded-xl p-2 transition-[background-color] duration-150 hover:bg-neutral-100">
          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-neutral-100 text-neutral-600 ring-1 ring-inset ring-black/[0.03] transition-[background-color] duration-150 group-hover:bg-white">
            {image ? <img src={`/design/akcja-${image}.png`} alt="" width="32" height="32" loading="lazy" decoding="async" className="size-8 object-contain"/>
              : <ArrowRight aria-hidden className="size-4" strokeWidth={1.75}/>}</span>
          <span className="min-w-0 flex-1 py-px">
            <span className="flex items-center gap-1.5 text-[12px] leading-4 text-neutral-500">
              <StatusDot tone={statusTone(field.report.water_status)}/><span className="truncate">{field.name}</span></span>
            <span className="mt-1 block text-[13.5px] font-medium leading-snug text-neutral-900">{action.title}</span>
          </span>
        </motion.a>
      </li>;
    })}</ul> : <p className="mt-2 text-[13px] text-neutral-500">Zapisane raporty nie zawierają propozycji działań.</p>}
  </section>;
}

// ---------- prognoza pogody ----------

/** Kod pogody WMO → [ilustracja z /design/pogoda-*.png, opis]. */
export function weatherIcon(code) {
  if (code === 0) return ['slonce', 'Bezchmurnie'];
  if (code === 1 || code === 2) return ['przejasnienia', 'Częściowe zachmurzenie'];
  if (code === 3) return ['pochmurno', 'Zachmurzenie'];
  if (code === 45 || code === 48) return ['mgla', 'Mgła'];
  if ([71, 73, 75, 77, 85, 86].includes(code)) return ['snieg', 'Śnieg'];
  if (code >= 95) return ['burza', 'Burza'];
  if (Number.isFinite(code) && code >= 51) return ['deszcz', 'Opad'];
  return [null, 'Brak danych'];
}
const weekdays = new Intl.DateTimeFormat('pl-PL', { weekday: 'short', timeZone: 'Europe/Warsaw' });

// Wiersze komórki dnia mają stałą wysokość: szkielet i prognoza zajmują tyle samo miejsca, więc odsłonięcie nie przesuwa treści.
// `lg` dopasowuje się do szerokości kontenera: w wąskim (raport na telefonie) mniejsze komórki i parowanie bez podpisu w kolumnie.
const SIZES = {
  sm: { list: 'gap-1', cell: 'rounded-lg py-2', day: 'h-4 text-[11.5px]', icon: 'h-8', glyph: 'size-7', temp: 'h-5 text-[14px]',
    rain: 'h-4 text-[10px]', bar: 'h-2.5 w-6' },
  lg: { list: 'gap-1 @xl/forecast:gap-2', cell: 'rounded-lg py-3 @xl/forecast:rounded-xl @xl/forecast:py-4',
    day: 'h-5 text-[11.5px] @xl/forecast:text-[12.5px]', icon: 'h-10 @xl/forecast:h-12', glyph: 'size-9 @xl/forecast:size-11',
    temp: 'h-7 text-[17px] @xl/forecast:h-8 @xl/forecast:text-[20px]', rain: 'h-5 text-[11px] @xl/forecast:text-[12.5px]',
    bar: 'h-3 w-7 @xl/forecast:h-3.5 @xl/forecast:w-9', et0: 'h-5 @xl/forecast:h-9' },
};

// minus typograficzny zamiast łącznika (−1°, nie -1°)
const temperature = (value) => `${number(value).replace('-', '−')}°`;
// w wąskiej kolumnie (sm) opad od 10 mm bez części dziesiętnej, żeby liczby sąsiednich dni się nie zlewały
const rainText = (mm, big) => `${number(mm, big || mm < 10 ? 1 : 0)} mm`;
const shortDate = (iso) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;
const VISIBLE_DAYS = 7;

/** Punkty zatrzymania karuzeli: pełne 7-dniowe okna bez pustych dziur na końcu (dla 16 dni: 0, 7, 9). */
function forecastStops(total, visible = VISIBLE_DAYS) {
  if (total <= visible) return [0];
  const max = total - visible;
  const stops = [];
  for (let i = 0; i < max; i += visible) stops.push(i);
  stops.push(max);
  return stops;
}

/** Jedna komórka dnia w pasku prognozy: w widoku `big` (zakładka Pogoda) spójna kafelka dnia z wyraźną hierarchią. */
function ForecastCell({ day, big, isToday, s }) {
  const [icon, label] = weatherIcon(day.weather_code);
  const wet = day.precipitation_mm >= 5;
  const weekday = isToday ? 'dziś' : weekdays.format(new Date(day.date + 'T12:00:00Z')).replace('.', '');

  if (big) {
    return <div className={cn(
      'flex h-full min-w-0 flex-col items-center rounded-xl border px-2 py-3.5 text-center transition-colors @xl/forecast:px-3 @xl/forecast:py-4',
      isToday ? 'border-brand-600/25 bg-white shadow-hairline'
        : wet ? 'border-water-200/80 bg-water-50/70'
          : 'border-black/[0.06] bg-neutral-50/55')}>
      <span className={cn('text-[12.5px] font-semibold leading-tight @xl/forecast:text-[13.5px]',
        isToday ? 'text-brand-700' : 'text-neutral-800')}>{weekday}</span>
      <span className="num mt-0.5 text-[11px] leading-tight text-neutral-400">{shortDate(day.date)}</span>
      <span className="my-2.5 flex h-10 items-center justify-center @xl/forecast:my-3 @xl/forecast:h-11">
        {icon ? <img src={`/design/pogoda-${icon}.png`} alt={label} title={label} width="44" height="44" decoding="async"
          className="size-9 object-contain @xl/forecast:size-11"/>
          : <span role="img" aria-label={label} className="text-neutral-400">—</span>}
      </span>
      <span className={cn('num text-[18px] font-semibold leading-none tracking-tight text-neutral-950 @xl/forecast:text-[21px]',
        day.temperature_max_c != null && 'pl-[0.2em]')}>
        {day.temperature_max_c == null ? '—' : temperature(day.temperature_max_c)}</span>
      <span className="num mt-1.5 h-3.5 text-[11.5px] leading-none text-neutral-400">
        {day.temperature_min_c != null ? `noc ${temperature(day.temperature_min_c)}` : ''}</span>
      <dl className="mt-3 w-full space-y-1 border-t border-black/[0.06] pt-2.5 text-[11px] leading-tight @xl/forecast:text-[12px]">
        <div className="flex flex-col items-center @2xl/forecast:flex-row @2xl/forecast:justify-between">
          <dt className="hidden text-neutral-400 @2xl/forecast:inline">Opad</dt>
          <dd className={cn('num whitespace-nowrap', day.precipitation_mm > 0 ? 'font-semibold text-water-700' : 'text-neutral-400')}>
            {day.precipitation_mm == null ? '—' : rainText(day.precipitation_mm, true)}</dd>
        </div>
        <div className="flex flex-col items-center @2xl/forecast:flex-row @2xl/forecast:justify-between">
          <dt className="hidden text-neutral-400 @2xl/forecast:inline">Parow.</dt>
          <dd className="num whitespace-nowrap text-neutral-600">
            {day.et0_mm == null ? '—' : `${number(day.et0_mm, 1)} mm`}</dd>
        </div>
      </dl>
    </div>;
  }

  return <div className={cn('flex min-w-0 flex-col items-center', s.cell, wet && 'bg-water-50')}>
    <span className={cn('flex items-center font-medium', s.day, isToday ? 'text-neutral-900' : 'text-neutral-500')}>
      {weekday}</span>
    <span className="num text-[10px] leading-tight text-neutral-400">{shortDate(day.date)}</span>
    <span className={cn('flex items-center', s.icon)}>
      {/* brak kodu pogody: kreska zamiast obrazka, żeby nie udawać zachmurzenia */}
      {icon ? <img src={`/design/pogoda-${icon}.png`} alt={label} title={label} width="40" height="40" decoding="async"
        className={cn('object-contain', s.glyph)}/>
        : <span role="img" aria-label={label} className="text-neutral-400">—</span>}</span>
    {/* znak stopnia przesuwa liczbę w lewo; lewy odstęp centruje same cyfry */}
    <span className={cn('num flex items-center font-semibold tracking-tight text-neutral-900', s.temp, day.temperature_max_c != null && 'pl-[0.25em]')}>
      {day.temperature_max_c == null ? '—' : temperature(day.temperature_max_c)}</span>
    <span className={cn('num flex items-center whitespace-nowrap font-medium tracking-tight text-water-700', s.rain)}>
      {day.precipitation_mm > 0 && rainText(day.precipitation_mm, false)}</span>
  </div>;
}

/** Pasek 7 dni z płynnym przesuwaniem w poziomie (karuzela po wszystkich pobranych dniach prognozy). */
function ForecastStrip({ days, big, offset, canPrev, canNext }) {
  const s = big ? SIZES.lg : SIZES.sm;
  const reduced = useReducedMotion();
  if (!days) return <ol aria-hidden className={cn('grid grid-cols-7', big ? 'gap-2 @xl/forecast:gap-3' : s.list)}>
    {Array.from({ length: VISIBLE_DAYS }, (_, i) => <li key={i} className={cn('flex flex-col items-center',
      big ? 'rounded-xl border border-black/[0.05] bg-neutral-50/50 px-2 py-3.5 @xl/forecast:py-4' : s.cell)}>
      <span className={cn('flex items-center', s.day)}><span className="h-2.5 w-6 rounded-full bg-neutral-200/80"/></span>
      <span className="mt-1 h-2.5 w-8 rounded-full bg-neutral-200/60"/>
      <span className={cn('flex items-center', big ? 'my-2.5 h-10 @xl/forecast:my-3 @xl/forecast:h-11' : s.icon)}>
        <span className={cn('rounded-full bg-neutral-200/80', s.glyph)}/></span>
      <span className={cn('flex items-center', s.temp)}><span className={cn('rounded-full bg-neutral-200/80', s.bar)}/></span>
      {big && <span className="mt-5 h-7 w-full rounded bg-neutral-200/50"/>}
    </li>)}
  </ol>;

  const todayIso = today();
  const total = days.length;
  const visible = Math.min(VISIBLE_DAYS, total);
  const pad = big ? 'px-1 @xl/forecast:px-1.5' : 'px-0.5';

  return <div className={cn('relative overflow-hidden', big ? '-mx-1 @xl/forecast:-mx-1.5' : '-mx-0.5')}>
    <motion.ol aria-label={`Prognoza pogody na ${total} dni`}
      className="flex items-stretch"
      style={{ width: `${(total / visible) * 100}%` }}
      animate={{ x: `${-(offset / total) * 100}%` }}
      transition={reduced ? { duration: 0 } : SPRING_LAYOUT}>
      {days.map((day, idx) => <li key={day.date} style={{ width: `${100 / total}%` }}
        aria-hidden={idx < offset || idx >= offset + visible}
        className={cn('shrink-0', pad)}>
        <ForecastCell day={day} big={big} isToday={day.date === todayIso} s={s}/>
      </li>)}
    </motion.ol>
    {/* subtelne wygaszenie krawędzi tam, gdzie czekają kolejne dni */}
    <div aria-hidden className={cn('pointer-events-none absolute inset-y-0 left-0 w-5 bg-gradient-to-r from-white to-transparent transition-opacity duration-200',
      canPrev ? 'opacity-90' : 'opacity-0')}/>
    <div aria-hidden className={cn('pointer-events-none absolute inset-y-0 right-0 w-5 bg-gradient-to-l from-white to-transparent transition-opacity duration-200',
      canNext ? 'opacity-90' : 'opacity-0')}/>
  </div>;
}

/** Animowany przycisk strzałki do przewijania prognozy w lewo / w prawo. */
function CarouselArrow({ direction, disabled, onClick, big = false }) {
  const Icon = direction === 'prev' ? ChevronLeft : ChevronRight;
  const label = direction === 'prev' ? 'Poprzednie dni prognozy' : 'Kolejne dni prognozy';
  return <motion.button type="button" disabled={disabled} onClick={onClick} aria-label={label}
    whileHover={disabled ? undefined : { scale: 1.06 }}
    whileTap={disabled ? undefined : { scale: 0.92 }}
    transition={SPRING_PRESS}
    className={cn('grid place-items-center rounded-full border border-black/[0.08] bg-white text-neutral-700 shadow-hairline',
      big ? 'size-8' : 'size-7',
      'transition-[color,background-color,border-color,opacity] duration-150',
      disabled ? 'cursor-default opacity-35 shadow-none' : 'hover:border-black/[0.16] hover:bg-neutral-50 hover:text-neutral-950')}>
    <Icon className="size-4" strokeWidth={2}/>
  </motion.button>;
}

/**
 * Prognoza pogody od dziś dla współrzędnych (Open-Meteo przez /api/forecast, do 16 dni).
 * Pokazuje zawsze 7 dni w jednym wierszu i pozwala płynnie przewijać strzałkami w lewo i w prawo.
 */
export function ForecastDays({ position, size = 'sm', onRangeChange }) {
  const key = position ? new URLSearchParams({ lat: position.lat, lon: position.lon, days: '16' }).toString() : null;
  const [weather, setWeather] = useState(null);
  const [page, setPage] = useState(0);

  useEffect(() => {
    setPage(0);
    if (!key) return;
    const controller = new AbortController();
    api('/api/forecast?' + key, { signal: controller.signal }).then((data) => setWeather({ key, data }))
      .catch((error) => { if (!controller.signal.aborted) setWeather({ key, data: { status: 'error', reason: error.message } }); });
    return () => controller.abort();
  }, [key]);

  const forecast = weather?.key === key ? weather.data : null;
  const days = forecast?.days;
  const stops = forecastStops(days?.length ?? 0);
  const safePage = Math.min(page, stops.length - 1);
  const offset = stops[safePage] ?? 0;
  const canPrev = safePage > 0;
  const canNext = safePage < stops.length - 1;
  const big = size === 'lg';

  const firstVisible = days?.[offset];
  const lastVisible = days?.[Math.min((days?.length ?? 1) - 1, offset + VISIBLE_DAYS - 1)];
  const todayIso = today();
  const rangeLabel = firstVisible && lastVisible
    ? `${firstVisible.date === todayIso ? 'dziś' : shortDate(firstVisible.date)} – ${shortDate(lastVisible.date)}`
    : null;

  useEffect(() => {
    if (onRangeChange && firstVisible && lastVisible) {
      onRangeChange({ from: firstVisible.date, to: lastVisible.date, label: rangeLabel });
    }
  }, [onRangeChange, firstVisible?.date, lastVisible?.date, rangeLabel]);

  function onKeyDown(event) {
    if (event.key === 'ArrowLeft' && canPrev) { event.preventDefault(); setPage((p) => Math.max(0, p - 1)); }
    if (event.key === 'ArrowRight' && canNext) { event.preventDefault(); setPage((p) => Math.min(stops.length - 1, p + 1)); }
  }

  if (!key) return <p className="text-[13px] text-neutral-500">Brak współrzędnych pola.</p>;
  if (forecast && forecast.status !== 'ok') {
    return <div role={forecast.status === 'error' ? 'alert' : 'status'}><Note section={forecast} className="my-0"/></div>;
  }

  return <div className="@container/forecast" onKeyDown={onKeyDown}>
    {stops.length > 1 && <div className={cn('no-print flex items-center justify-between gap-2', big ? 'mb-4' : 'mb-2.5')}>
      <span className={cn('num font-medium text-neutral-600', big ? 'text-[13px]' : 'text-[12px] text-neutral-500')}>{rangeLabel}</span>
      <div className="flex items-center gap-2.5">
        <div className="flex items-center gap-1" role="tablist" aria-label="Okres prognozy">
          {stops.map((stop, idx) => <button key={stop} type="button" role="tab" aria-selected={idx === safePage}
            aria-label={`Dni ${stop + 1}–${Math.min(days.length, stop + VISIBLE_DAYS)}`}
            onClick={() => setPage(idx)}
            className="grid size-4 place-items-center">
            <span className={cn('block rounded-full transition-[width,background-color] duration-200',
              idx === safePage ? 'h-1.5 w-3.5 bg-brand-600' : 'size-1.5 bg-neutral-300 hover:bg-neutral-400')}/>
          </button>)}
        </div>
        <div className="flex items-center gap-1.5">
          <CarouselArrow direction="prev" big={big} disabled={!canPrev} onClick={() => setPage((p) => Math.max(0, p - 1))}/>
          <CarouselArrow direction="next" big={big} disabled={!canNext} onClick={() => setPage((p) => Math.min(stops.length - 1, p + 1))}/>
        </div>
      </div>
    </div>}
    <SkeletonReveal loading={!forecast} pulseCount={4} pulseDuration={1200} skeleton={<ForecastStrip big={big} offset={0}/>}>
      <ForecastStrip big={big} days={days} offset={offset} canPrev={canPrev} canNext={canNext}/>
    </SkeletonReveal>
    {/* w wąskim widoku `lg` kolumny nie mają etykiet „Opad / Parow.”, więc objaśnienie raz pod siatką */}
    {big && <p className="mt-3 text-[12px] text-neutral-500 @2xl/forecast:hidden">Na niebiesko opad, niżej parowanie (ET0).</p>}
    <p role="status" className={cn('flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[12px] leading-snug text-neutral-500',
      big ? 'mt-4 border-t border-black/[0.06] pt-3' : 'mt-3')}>
      {forecast ? <>
        <span>{forecast.last_wet_day ? <>Ostatni opad &gt;5 mm: <span className="num">{dateText(forecast.last_wet_day)}</span></>
          : forecast.past_days_complete ? 'Brak opadu >5 mm w ostatnich 30 dniach.' : 'Niepełne dane o ostatnich opadach.'}</span>
        <span aria-hidden className="text-neutral-300">·</span>
        <a href="https://open-meteo.com/en/docs" target="_blank" rel="noreferrer"
          className="rounded-sm text-neutral-600 underline decoration-neutral-300 underline-offset-2 transition-[color,text-decoration-color] duration-150 hover:text-brand-700 hover:decoration-brand-300">
          Open-Meteo</a>
      </> : <span className="text-neutral-400">Pobieram prognozę…</span>}
    </p>
  </div>;
}

/** Prognoza dla jednego pola; przy kilku polach wybór pola (segmenty dla 2–3 krótkich nazw, inaczej lista). */
function Weather({ fields, style }) {
  const titleId = useId();
  const selectId = useId();
  const [selected, setSelected] = useState(null);
  const field = fields.find(({ id }) => id === selected) ?? fields[0];
  // segmenty muszą się zmieścić w wąskiej karcie (ok. 260 px), więc tylko przy krótkich nazwach
  const segmented = fields.length <= 3 && fields.every(({ name }) => name.length <= (fields.length === 2 ? 16 : 9));
  return <section aria-labelledby={titleId} className={cn('surface p-5', RISE)} style={style}>
    <div className="flex items-baseline justify-between gap-3">
      <h2 id={titleId} className="font-sans text-[15px] font-semibold tracking-tight text-neutral-900">Prognoza pogody</h2>
      <span className="text-[12.5px] text-neutral-500">do 16 dni</span>
    </div>
    {fields.length > 1 && (segmented
      // na ekranach dotykowych segmenty mają co najmniej 40 px wysokości
      ? <Segmented className="mt-3 w-full" label="Pole, dla którego pokazać prognozę" value={field.id} onChange={setSelected}
        options={fields.map(({ id, name }) => ({ value: id, label: name }))}/>
      : <div className="mt-3 flex items-center gap-3">
        <Label htmlFor={selectId} className="mb-0 shrink-0 text-neutral-500">Dla pola</Label>
        <div className="min-w-0 flex-1">
          <NativeSelect id={selectId} value={field.id} onChange={(event) => setSelected(event.target.value)}>
            {fields.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
          </NativeSelect>
        </div>
      </div>)}
    <div className="mt-4"><ForecastDays position={field.report.parcel?.centroid ?? field.report.request.point}/></div>
  </section>;
}

// ---------- pulpit ----------

export function Dashboard({ fields, onAdd, onEdit, onDelete }) {
  const fieldsTitleId = useId();
  const [intro] = useState(() => !introPlayed);
  useEffect(() => { if (fields.length) introPlayed = true; }, [fields.length]);
  if (!fields.length) return <EmptyState onAdd={onAdd}/>;
  // pola bez raportu (pierwsze liczenie trwa albo się nie udało) na górze, potem od najpilniejszego
  const ready = fields.filter((field) => field.report);
  const sorted = [...fields.filter((field) => !field.report), ...byUrgency(ready)];
  const actions = actionItems(ready);
  const date = new Intl.DateTimeFormat('pl-PL', { dateStyle: 'full', timeZone: 'Europe/Warsaw' }).format(new Date());
  // wejście (kaskada kart, pasek, liczniki) raz na sesję; po powrocie z raportu pulpit jest od razu na miejscu
  return <div className={cn('@container/dash flex flex-col gap-10', !intro && '[&_.animate-in]:!animate-none [&_.animate-rise]:!animate-none')}>
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <div className="min-w-0">
        <Eyebrow>{date}</Eyebrow>
        <h1 className="mt-2 font-display text-[28px] font-semibold leading-[1.05] tracking-tight md:text-[34px]">Pulpit</h1>
      </div>
      <Button icon={<Plus/>} onClick={onAdd} data-tour="add">Dodaj pole</Button>
    </header>
    {ready.length > 0 && <Overview fields={ready} intro={intro}/>}
    {/* kolumna boczna dopiero od 64rem szerokości pulpitu (prognoza potrzebuje ok. 290 px); węziej karty, a pod nimi panele */}
    <div className="grid gap-x-8 gap-y-10 @5xl/dash:grid-cols-12">
      <section aria-labelledby={fieldsTitleId} className="min-w-0 @5xl/dash:col-span-8">
        <h2 id={fieldsTitleId} className="mb-4 font-display text-[20px] font-semibold leading-[26px] tracking-tight">Pola od najpilniejszego</h2>
        <div className="grid gap-4 @xl/dash:grid-cols-2">
          {sorted.map((field, i) => {
            const Tile = field.report ? FieldCard : PendingFieldCard;
            return <Tile key={field.id} field={field} onEdit={onEdit} onDelete={onDelete}
              style={riseDelay(80 + STAGGER[Math.min(i, STAGGER.length - 1)])}/>;
          })}
        </div>
      </section>
      {/* obok kart: górna krawędź równo z pierwszym rzędem kart (wysokość nagłówka 26 px + odstęp 16 px) */}
      <aside aria-label="Działania i pogoda"
        className="grid min-w-0 content-start gap-4 @2xl/dash:grid-cols-2 @5xl/dash:col-span-4 @5xl/dash:grid-cols-1 @5xl/dash:pt-[42px]">
        <NextActions items={actions} style={riseDelay(140)}/>
        {ready.length > 0 && <Weather fields={byUrgency(ready)} style={riseDelay(190)}/>}
      </aside>
    </div>
  </div>;
}
