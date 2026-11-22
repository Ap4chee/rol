import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { forecastQuery } from '@/api/endpoints';
import { SPRING_PRESS } from '@/shared/lib/ease';
import { dateText, today } from '@/shared/format/date';
import { SkeletonReveal } from '@/shared/ui/effects';
import { Note } from '@/shared/ui/note';
import { cn } from '@/shared/lib/cn';
import { FORECAST_DAYS, forecastStops, rangeLabel, VISIBLE_DAYS } from './logic.js';
import { ForecastStrip } from './ForecastStrip.jsx';
import { useForecast } from './useForecast.js';

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
  const key = position ? forecastQuery(position, FORECAST_DAYS) : null;
  const forecast = useForecast(key);
  const [page, setPage] = useState(0);
  useEffect(() => { setPage(0); }, [key]);

  const days = forecast?.days;
  const stops = forecastStops(days?.length ?? 0);
  const safePage = Math.min(page, stops.length - 1);
  const offset = stops[safePage] ?? 0;
  const canPrev = safePage > 0;
  const canNext = safePage < stops.length - 1;
  const big = size === 'lg';

  const firstVisible = days?.[offset];
  const lastVisible = days?.[Math.min((days?.length ?? 1) - 1, offset + VISIBLE_DAYS - 1)];
  const range = rangeLabel(firstVisible, lastVisible, today());

  useEffect(() => {
    if (onRangeChange && firstVisible && lastVisible) {
      onRangeChange({ from: firstVisible.date, to: lastVisible.date, label: range });
    }
  }, [onRangeChange, firstVisible?.date, lastVisible?.date, range]);

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
      <span className={cn('num font-medium text-neutral-600', big ? 'text-[13px]' : 'text-[12px] text-neutral-500')}>{range}</span>
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
