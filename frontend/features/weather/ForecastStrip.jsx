import { motion, useReducedMotion } from 'motion/react';
import { SPRING_LAYOUT } from '@/shared/lib/ease';
import { dayMonth, dayName, today } from '@/shared/format/date';
import { degrees, number } from '@/shared/format/number';
import { weatherIcon } from '@/shared/assets';
import { cn } from '@/shared/lib/cn';
import { rainText, VISIBLE_DAYS, WET_DAY_MM } from './logic.js';

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

/** Jedna komórka dnia w pasku prognozy: w widoku `big` (zakładka Pogoda) spójna kafelka dnia z wyraźną hierarchią. */
function ForecastCell({ day, big, isToday, s }) {
  const [icon, label] = weatherIcon(day.weather_code);
  const wet = day.precipitation_mm >= WET_DAY_MM;
  const weekday = dayName(day.date, isToday ? day.date : null);

  if (big) {
    return <div className={cn(
      'flex h-full min-w-0 flex-col items-center rounded-xl border px-2 py-3.5 text-center transition-colors @xl/forecast:px-3 @xl/forecast:py-4',
      isToday ? 'border-brand-600/25 bg-white shadow-hairline'
        : wet ? 'border-water-200/80 bg-water-50/70'
          : 'border-black/[0.06] bg-neutral-50/55')}>
      <span className={cn('text-[12.5px] font-semibold leading-tight @xl/forecast:text-[13.5px]',
        isToday ? 'text-brand-700' : 'text-neutral-800')}>{weekday}</span>
      <span className="num mt-0.5 text-[11px] leading-tight text-neutral-400">{dayMonth(day.date)}</span>
      <span className="my-2.5 flex h-10 items-center justify-center @xl/forecast:my-3 @xl/forecast:h-11">
        {icon ? <img src={`/design/pogoda-${icon}.png`} alt={label} title={label} width="44" height="44" decoding="async"
          className="size-9 object-contain @xl/forecast:size-11"/>
          : <span role="img" aria-label={label} className="text-neutral-400">—</span>}
      </span>
      <span className={cn('num text-[18px] font-semibold leading-none tracking-tight text-neutral-950 @xl/forecast:text-[21px]',
        day.temperature_max_c != null && 'pl-[0.2em]')}>
        {day.temperature_max_c == null ? '—' : degrees(day.temperature_max_c)}</span>
      <span className="num mt-1.5 h-3.5 text-[11.5px] leading-none text-neutral-400">
        {day.temperature_min_c != null ? `noc ${degrees(day.temperature_min_c)}` : ''}</span>
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
    <span className="num text-[10px] leading-tight text-neutral-400">{dayMonth(day.date)}</span>
    <span className={cn('flex items-center', s.icon)}>
      {/* brak kodu pogody: kreska zamiast obrazka, żeby nie udawać zachmurzenia */}
      {icon ? <img src={`/design/pogoda-${icon}.png`} alt={label} title={label} width="40" height="40" decoding="async"
        className={cn('object-contain', s.glyph)}/>
        : <span role="img" aria-label={label} className="text-neutral-400">—</span>}</span>
    {/* znak stopnia przesuwa liczbę w lewo; lewy odstęp centruje same cyfry */}
    <span className={cn('num flex items-center font-semibold tracking-tight text-neutral-900', s.temp, day.temperature_max_c != null && 'pl-[0.25em]')}>
      {day.temperature_max_c == null ? '—' : degrees(day.temperature_max_c)}</span>
    <span className={cn('num flex items-center whitespace-nowrap font-medium tracking-tight text-water-700', s.rain)}>
      {day.precipitation_mm > 0 && rainText(day.precipitation_mm, false)}</span>
  </div>;
}

/** Pasek 7 dni z płynnym przesuwaniem w poziomie (karuzela po wszystkich pobranych dniach prognozy). */
export function ForecastStrip({ days, big, offset, canPrev, canNext }) {
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
