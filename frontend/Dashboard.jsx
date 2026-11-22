import { useEffect, useId, useState } from 'react';
import { motion } from 'motion/react';
import { ArrowRight, ChevronRight, CloudRain, Droplet, Droplets,Layers, Plus, Sprout, Waves } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, Eyebrow } from '@/components/ui/card';
import { Label, NativeSelect } from '@/components/ui/field';
import { Meter } from '@/components/ui/meter';
import { Segmented } from '@/components/ui/segmented';
import { StatusDot, TONE } from '@/components/ui/status';
import { NumberTicker } from '@/components/spectrumui/number-ticker';
import { SkeletonReveal } from '@/components/spectrumui/skeleton-reveal';
import { cn } from '@/lib/utils';
import { actionItems, byUrgency, dateText, fieldHref, fieldTabHref, number, today, waterPercent } from './model.js';
import { api, Note, ParcelOutline, Status, statusFill, statusInk, statusTone } from './ui.jsx';

const CROP_IMAGES = { maize: 'kukurydza', winter_wheat: 'pszenica', spring_barley: 'jeczmien', winter_rapeseed: 'rzepak', grassland: 'laka', potato: 'ziemniaki', sugar_beet: 'burak' };

// Pierwsze wejście bloku: krótko w górę z przezroczystości. Przy ograniczonym ruchu samo przenikanie, bez przesunięcia.
const RISE = 'animate-rise motion-reduce:animate-in motion-reduce:fade-in motion-reduce:fill-mode-both';
// Kaskada kart przy wejściu na pulpit: nierówne odstępy (ms); od siódmej karty bez dalszej zwłoki.
const STAGGER = [0, 50, 90, 120, 145, 165];
const riseDelay = (ms) => ({ animationDelay: `${ms}ms` });
let introPlayed = false;   // wejście pulpitu tylko raz na sesję, nie przy powrocie z raportu

// ---------- pusty pulpit ----------

// Ilustracje 3D (makiety pola z przekrojem gleby) w /design; cień z CSS, bo obrazki mają przezroczyste tło bez cienia
const ART_SHADOW = 'drop-shadow-[0_10px_14px_rgba(0,0,0,0.12)]';

/** Pusty pulpit: ilustracja, jedno zdanie i przycisk; samo dodawanie pola jest w modalu. */
function EmptyState({ onAdd }) {
  return <div className={cn('mx-auto flex max-w-[460px] flex-col items-center px-2 py-16 text-center md:py-24', RISE)}>
    <img src="/design/pole.webp" alt="" width="360" height="220" decoding="async" className={cn('h-auto w-[300px] md:w-[360px]', ART_SHADOW)}/>
    <h1 className="mt-6 font-display text-[28px] font-semibold leading-[1.05] tracking-tight md:text-[34px]">Dodaj pierwsze pole</h1>
    <p className="mt-3 max-w-[42ch] text-[15px] leading-relaxed text-neutral-600">
      Wpisz numer działki albo wskaż ją na mapie. Sprawdzimy, czy brakuje jej wody i co z tym zrobić.</p>
    <Button size="lg" className="mt-8" icon={<Plus/>} onClick={onAdd}>Dodaj pole</Button>
  </div>;
}

// ---------- pierwszy rzut oka ----------

const BUCKETS = [
  ['severe', 'severe', 'silny niedobór'], ['moderate', 'moderate', 'umiarkowany niedobór'],
  ['watch', 'watch', 'do obserwacji'], ['none', 'ok', 'bez niedoboru'],
];
const BUCKET_IMAGES = { severe: 'silny', moderate: 'umiarkowany', watch: 'obserwacja', none: 'ok', unknown: 'brak' };

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

/** Karta pola (cała jest linkiem): uprawa, stan wody (duży procent zapasu w strefie korzeni, plakietka, pasek), pierwszy krok retencji, na dole szczegóły retencji (pojemność gleby, bilans, ciek).
 *  Działania są obok w „Najbliższe działania”, a pełny opis stanu w raporcie pola, więc karta ich nie powtarza. */
function FieldCard({ field, style }) {
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
  // focus-visible:outline-solid: `outline-none` z Card zeruje styl obrysu w Tailwind v4, więc bez tego fokus klawiatury byłby niewidoczny
  return <Card asChild interactive className={cn('group flex min-w-0 flex-col p-5 focus-visible:outline-solid', RISE)} style={style}>
    <a href={fieldHref(field.id)}>
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
function weatherIcon(code) {
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

/** Siedem równych kolumn (dzień, ikona, temperatura maks., opad; w `big` także parowanie). Bez `days`: szkielet tej samej wielkości. */
function ForecastGrid({ days, big }) {
  const s = big ? SIZES.lg : SIZES.sm;
  if (!days) return <ol aria-hidden className={cn('grid grid-cols-7', s.list)}>
    {Array.from({ length: 7 }, (_, i) => <li key={i} className={cn('flex flex-col items-center', s.cell)}>
      <span className={cn('flex items-center', s.day)}><span className="h-2 w-5 rounded-full bg-neutral-200/80"/></span>
      <span className={cn('flex items-center', s.icon)}><span className={cn('rounded-full bg-neutral-200/80', s.glyph)}/></span>
      <span className={cn('flex items-center', s.temp)}><span className={cn('rounded-full bg-neutral-200/80', s.bar)}/></span>
      <span className={s.rain}/>
      {big && <span className={s.et0}/>}
    </li>)}
  </ol>;
  const todayIso = today();
  return <ol aria-label="Prognoza na 7 dni" className={cn('grid grid-cols-7', s.list)}>
    {days.map((day) => {
      const [icon, label] = weatherIcon(day.weather_code);
      const isToday = day.date === todayIso;
      return <li key={day.date} className={cn('flex min-w-0 flex-col items-center', s.cell, day.precipitation_mm >= 5 && 'bg-water-50')}>
        <span className={cn('flex items-center font-medium', s.day, isToday ? 'text-neutral-900' : 'text-neutral-500')}>
          {isToday ? 'dziś' : weekdays.format(new Date(day.date + 'T12:00:00Z')).replace('.', '')}</span>
        <span className={cn('flex items-center', s.icon)}>
          {/* brak kodu pogody: kreska zamiast obrazka, żeby nie udawać zachmurzenia */}
          {icon ? <img src={`/design/pogoda-${icon}.png`} alt={label} title={label} width="40" height="40" decoding="async"
            className={cn('object-contain', s.glyph)}/>
            : <span role="img" aria-label={label} className="text-neutral-400">—</span>}</span>
        {/* znak stopnia przesuwa liczbę w lewo; lewy odstęp centruje same cyfry */}
        <span className={cn('num flex items-center font-semibold tracking-tight text-neutral-900', s.temp, day.temperature_max_c != null && 'pl-[0.25em]')}>
          {day.temperature_max_c == null ? '—' : temperature(day.temperature_max_c)}</span>
        <span className={cn('num flex items-center whitespace-nowrap font-medium tracking-tight text-water-700', s.rain)}>
          {day.precipitation_mm > 0 && rainText(day.precipitation_mm, big)}</span>
        {big && <span className={cn('flex flex-col items-center justify-center text-[10.5px] leading-tight text-neutral-500', s.et0)}>
          {day.et0_mm != null && <><span className="hidden @xl/forecast:block">parowanie</span>
            <span className="num whitespace-nowrap text-neutral-600">{number(day.et0_mm, 1)} mm</span></>}</span>}
      </li>;
    })}
  </ol>;
}

/**
 * Prognoza na 7 dni od dziś dla współrzędnych (Open-Meteo przez /api/forecast). Ładowanie: szkielet, który przenika
 * w prognozę (Skeleton Reveal ze Spectrum UI). `size="lg"`: większe komórki i parowanie (zakładka Pogoda w raporcie).
 */
export function ForecastDays({ position, size = 'sm' }) {
  const key = position ? new URLSearchParams({ lat: position.lat, lon: position.lon }).toString() : null;
  const [weather, setWeather] = useState(null);
  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();
    api('/api/forecast?' + key, { signal: controller.signal }).then((data) => setWeather({ key, data }))
      .catch((error) => { if (!controller.signal.aborted) setWeather({ key, data: { status: 'error', reason: error.message } }); });
    return () => controller.abort();
  }, [key]);
  const forecast = weather?.key === key ? weather.data : null;
  const big = size === 'lg';
  if (!key) return <p className="text-[13px] text-neutral-500">Brak współrzędnych pola.</p>;
  if (forecast && forecast.status !== 'ok') {
    return <div role={forecast.status === 'error' ? 'alert' : 'status'}><Note section={forecast} className="my-0"/></div>;
  }
  return <div className="@container/forecast">
    <SkeletonReveal loading={!forecast} pulseCount={4} pulseDuration={1200} skeleton={<ForecastGrid big={big}/>}>
      <ForecastGrid big={big} days={forecast?.days}/>
    </SkeletonReveal>
    {/* w wąskim widoku `lg` kolumny nie mają podpisu „parowanie”, więc objaśnienie raz pod siatką */}
    {big && <p className="mt-3 text-[12px] text-neutral-500 @xl/forecast:hidden">Na niebiesko opad, na szaro parowanie.</p>}
    <p role="status" className={cn('flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[12px] leading-snug text-neutral-500', big ? 'mt-2 @xl/forecast:mt-4' : 'mt-3')}>
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
      <h2 id={titleId} className="font-sans text-[15px] font-semibold tracking-tight text-neutral-900">Pogoda na 7 dni</h2>
      <span className="text-[12.5px] text-neutral-500">od dziś</span>
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

export function Dashboard({ fields, onAdd }) {
  const fieldsTitleId = useId();
  const [intro] = useState(() => !introPlayed);
  useEffect(() => { if (fields.length) introPlayed = true; }, [fields.length]);
  if (!fields.length) return <EmptyState onAdd={onAdd}/>;
  const sorted = byUrgency(fields);
  const actions = actionItems(fields);
  const date = new Intl.DateTimeFormat('pl-PL', { dateStyle: 'full', timeZone: 'Europe/Warsaw' }).format(new Date());
  // wejście (kaskada kart, pasek, liczniki) raz na sesję; po powrocie z raportu pulpit jest od razu na miejscu
  return <div className={cn('@container/dash flex flex-col gap-10', !intro && '[&_.animate-in]:!animate-none [&_.animate-rise]:!animate-none')}>
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <div className="min-w-0">
        <Eyebrow>{date}</Eyebrow>
        <h1 className="mt-2 font-display text-[28px] font-semibold leading-[1.05] tracking-tight md:text-[34px]">Pulpit</h1>
      </div>
      <Button icon={<Plus/>} onClick={onAdd}>Dodaj pole</Button>
    </header>
    <Overview fields={fields} intro={intro}/>
    {/* kolumna boczna dopiero od 64rem szerokości pulpitu (prognoza potrzebuje ok. 290 px); węziej karty, a pod nimi panele */}
    <div className="grid gap-x-8 gap-y-10 @5xl/dash:grid-cols-12">
      <section aria-labelledby={fieldsTitleId} className="min-w-0 @5xl/dash:col-span-8">
        <h2 id={fieldsTitleId} className="mb-4 font-display text-[20px] font-semibold leading-[26px] tracking-tight">Pola od najpilniejszego</h2>
        <div className="grid gap-4 @xl/dash:grid-cols-2">
          {sorted.map((field, i) => <FieldCard key={field.id} field={field}
            style={riseDelay(80 + STAGGER[Math.min(i, STAGGER.length - 1)])}/>)}
        </div>
      </section>
      {/* obok kart: górna krawędź równo z pierwszym rzędem kart (wysokość nagłówka 26 px + odstęp 16 px) */}
      <aside aria-label="Działania i pogoda"
        className="grid min-w-0 content-start gap-4 @2xl/dash:grid-cols-2 @5xl/dash:col-span-4 @5xl/dash:grid-cols-1 @5xl/dash:pt-[42px]">
        <NextActions items={actions} style={riseDelay(140)}/>
        <Weather fields={sorted} style={riseDelay(190)}/>
      </aside>
    </div>
  </div>;
}
