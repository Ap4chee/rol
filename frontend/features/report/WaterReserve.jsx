import { dayMonth } from '@/shared/format/date';
import { minus, mm, number } from '@/shared/format/number';
import { Card } from '@/shared/ui/card';
import { WATER } from '@/shared/ui/colors';
import { StatCards } from '@/shared/ui/effects';
import { Note } from '@/shared/ui/note';
import { Section } from '@/shared/ui/section';
import { statusFill } from '@/features/fields/Status';
import { daysWord, waterFacts } from './logic.js';
import { WaterChart } from './WaterChart.jsx';

/** Klucz legendy: przerywana kreska jak linia „zwykle” na wykresie karty. */
function DashKey() {
  return <span aria-hidden className="mr-1.5 inline-block w-3 border-t border-dashed border-neutral-400 align-middle"/>;
}
/**
 * Trzy liczby pod wykresem z małymi wykresami sum narastających (bez zmiany procentowej: od zera nic by nie znaczyła).
 * Dane i warunki rysowania serii są w `waterFacts` (logic.js), tu tylko karty.
 */
function factCards(report) {
  const { rain, climat, history, stress, seasons, segments, rainDays, rainTotals, balanceDays, balanceTotals } = waterFacts(report);
  const typical = (median, drawn) => (median == null ? null : <>{drawn && <DashKey/>}zwykle {minus(mm(median))}</>);

  return [
    {
      label: 'Opad, 30 dni', value: rain?.rain_mm ?? null, unit: 'mm', format: (v) => number(v), delta: false,
      series: rainTotals, min: 0,
      reference: rainDays ? rain.rain_median_mm ?? null : null, color: WATER,
      pointLabel: (i) => `suma do ${dayMonth(rainDays[i].date)}`,
      caption: typical(rain?.rain_median_mm, Boolean(rainDays)),
    },
    {
      label: `Opad minus parowanie, ${climat?.days ?? 60} dni`, value: climat?.balance_mm ?? null, unit: 'mm',
      format: (v) => minus(number(v)), delta: false,
      series: balanceTotals,
      reference: balanceDays ? climat.median_10y_mm ?? null : null, color: WATER,
      baseline: 0, belowColor: 'var(--color-watch)', // nad zerem gleba się nawadnia, pod zerem przesycha
      pointLabel: (i) => `suma do ${dayMonth(balanceDays[i].date)}`,
      caption: typical(climat?.median_10y_mm, Boolean(balanceDays)),
    },
    {
      label: stress.long ? 'Sezony z długim niedoborem' : 'Sezony z niedoborem',
      value: history.seasons_total ? stress.count : null,
      unit: history.seasons_total ? `z ${history.seasons_total}` : undefined, format: (v) => number(v), delta: false,
      segments: segments ? seasons.map((s) => ({ active: stress.isStressed(s),
        label: `${s.season}: ${s.stress_days_critical} ${daysWord(s.stress_days_critical)} niedoboru` })) : undefined,
      segmentEnds: segments ? [seasons[0].season, seasons.at(-1).season] : undefined,
      progress: !segments && history.seasons_total ? stress.count / history.seasons_total : undefined,
      color: 'var(--color-moderate)',
      caption: stress.long ? `co najmniej ${stress.long} dni niedoboru` : 'ostatnie pełne sezony',
    },
  ];
}

/** Zapas wody: wykres z prognozą, uwagi o prognozie i karty liczb pod spodem. */
export function WaterReserve({ report, intro }) {
  const water = report.water_status;
  const series = water.series ?? [];
  const forecastNote = water.forecast_reason && !water.forecast?.length
    ? <p className="mt-3 text-[12.5px] leading-relaxed text-neutral-500">{water.forecast_reason}</p> : null;
  // prognoza modelu ML: opis z backendu albo powód, dla którego jej nie ma
  const ml = water.ml_forecast;
  const mlLines = ml ? (ml.available ? ml.text ?? [] : [`Prognoza modelu AI niedostępna: ${ml.reason}.`]) : [];
  const mlNote = mlLines.length
    ? <div className="mt-3 space-y-1 text-[12.5px] leading-relaxed text-neutral-500">{mlLines.map((line) => <p key={line}>{line}</p>)}</div> : null;
  return <Section title="Zapas wody w strefie korzeni">
    {series.length > 1
      ? <Card className="px-0 py-4 sm:p-5">
        <WaterChart series={series} forecast={water.forecast ?? []} ml={ml} color={statusFill(water)} intro={intro}/>
        {forecastNote && <div className="px-4 sm:px-0">{forecastNote}</div>}
        {mlNote && <div className="px-4 sm:px-0">{mlNote}</div>}
      </Card>
      : <>
        {water.status === 'ok'
          ? <p className="text-[14px] text-neutral-500">Za mało dni, żeby narysować przebieg zapasu.</p>
          : <Note section={water}/>}
        {forecastNote}
      </>}
    <StatCards className="mt-3" columns={3} intro={intro} cards={factCards(report)}/>
  </Section>;
}

