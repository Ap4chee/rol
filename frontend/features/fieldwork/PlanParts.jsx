// Klocki wspólne dla planu jednego pola (zakładka raportu) i planu wszystkich pól (osobna strona).
import { CalendarDays, Check, CircleHelp, Minus, TriangleAlert, X } from 'lucide-react';
import { dayMonth, dayName, today } from '@/shared/format/date';
import { degrees } from '@/shared/format/number';
import { weatherIcon } from '@/shared/assets';
import { TONE } from '@/shared/ui/status';
import { TH } from '@/shared/ui/table';
import { Tooltip } from '@/shared/ui/tooltip';
import { cn } from '@/shared/lib/cn';

export const RATINGS = {
  good: { label: 'Dobre warunki', tone: 'ok', Icon: Check },
  caution: { label: 'Ostrożnie', tone: 'watch', Icon: TriangleAlert },
  avoid: { label: 'Unikaj', tone: 'severe', Icon: X },
  unknown: { label: 'Brak danych', tone: 'unknown', Icon: CircleHelp },
  off: { label: 'Nie w tym okresie', tone: null, Icon: Minus },
};
// pierwsza kolumna zostaje na miejscu, gdy tabela przewija się w poziomie (telefon)
export const STICKY = 'sticky left-0 z-10 bg-white';
// ilustracja pracy: ciągnik z narzędziem na kawałku pola (static/design/praca-*.png)
export const opImage = (op) => `/design/praca-${op.image}.png`;

/** Ocena dnia: kolorowy kafelek z ikoną (kolor nie jest jedynym nośnikiem), powód w dymku i dla czytnika ekranu. */
export function RatingCell({ value }) {
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
export function WeekStrip({ days, op }) {
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
export function Legend({ children }) {
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

const temperature = (value) => (value == null ? '—' : degrees(value));

/** Nagłówek dnia; z `day` (plan jednego pola) także ikona pogody i temperatura maks. / min. */
export function DayHead({ date, day }) {
  const isToday = date === today();
  const [icon, label] = day ? weatherIcon(day.weather_code) : [];
  return <TH className={cn('text-center align-bottom', isToday && 'text-brand-700')}>
    <span className={cn('block font-semibold', isToday ? 'text-brand-700' : 'text-neutral-700')}>{dayName(date, today())}</span>
    <span className="num block font-normal">{dayMonth(date)}</span>
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
export function OperationLabel({ op }) {
  return <span className="flex items-center gap-2.5">
    <img src={opImage(op)} alt="" width="40" height="40" decoding="async" className="size-9 shrink-0 object-contain"/>
    <span className="font-medium leading-tight text-neutral-900">{op.label}</span>
  </span>;
}

/** Uwagi serwera o brakach danych (gleba umowna, luka w opadzie). */
export function Notes({ notes }) {
  return notes?.length > 0 && <ul className="mt-6 max-w-[80ch] list-disc space-y-1 pl-5 text-[12.5px] leading-relaxed text-neutral-500">
    {notes.map((note) => <li key={note}>{note}</li>)}</ul>;
}

/** Stan ładowania planu w miejscu tabeli. */
export function Loading({ text }) {
  return <p role="status" className="flex items-center gap-2 py-6 text-[13.5px] text-neutral-500">
    <CalendarDays aria-hidden className="size-4 animate-pulse"/>{text}</p>;
}

