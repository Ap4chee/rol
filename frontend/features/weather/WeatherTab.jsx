import { useState } from 'react';
import { ForecastDays } from './ForecastDays.jsx';
import { dateText, today } from '@/shared/format/date';
import { minus, number } from '@/shared/format/number';
import { Note } from '@/shared/ui/note';
import { Card } from '@/shared/ui/card';
import { Meter } from '@/shared/ui/meter';
import { measure, Stat } from '@/shared/ui/stat';
import { Caption, Table, TBody, TD, TH, THead, TR } from '@/shared/ui/table';
import { CauseList } from '@/shared/ui/cause-list';
import { Section } from '@/shared/ui/section';

// przyczyny pogodowe: opad, przeniesiony zapas, parowanie, upał, zapotrzebowanie uprawy
const WEATHER_CAUSE = /rain|precip|carry|et0|heat|temp|demand/;

/** Zakładka „Pogoda”: przewijana prognoza do 16 dni w spójnej karcie, opad i parowanie na tle 10 lat, wnioski. */
export function WeatherTab({ report }) {
  const water = report.water_status;
  const balance = water.climatic_water_balance;
  const position = report.parcel?.centroid ?? report.request.point;
  const isToday = report.analysis_date >= today();
  const causes = (report.causes.items ?? []).filter((cause) => WEATHER_CAUSE.test(cause.key));
  const [range, setRange] = useState(null);

  const allForecast = water.forecast ?? [];
  const syncedForecast = range
    ? allForecast.filter((d) => d.date >= range.from && d.date <= range.to)
    : [];
  const tableDays = syncedForecast.length ? syncedForecast : allForecast.slice(0, 7);

  const forecast = <Section key="forecast" title="Prognoza pogody">
    <Card className="p-4 sm:p-5 md:p-6">
      <ForecastDays position={position} size="lg" onRangeChange={setRange}/>
    </Card>
    {tableDays.length > 0 && <Card className="mt-5 p-4 sm:p-5 md:p-6">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-sans text-[15px] font-semibold tracking-tight text-neutral-900">Prognozowany zapas wody w glebie</h3>
        {range?.label && <span className="num text-[12.5px] text-neutral-500">{range.label}</span>}
      </div>
      <ForecastTable days={tableDays}/>
    </Card>}
  </Section>;
  const past = <div key="past" className="grid gap-12 lg:grid-cols-12">
    <Section title="Opad i parowanie na tle 10 lat" className="lg:col-span-7">
      <WeatherWindows windows={report.causes.windows} section={report.causes}/>
    </Section>
    <Section title="Co z tego wynika" className="lg:col-span-5">
      {balance && <Card className="mb-6 p-5">
        <Stat size="lg" label={`Opad minus parowanie, ${balance.days} dni`} value={measure(minus(number(balance.balance_mm)), 'mm')}
          hint={balance.median_10y_mm != null ? `zwykle ${minus(number(balance.median_10y_mm))} mm` : null}/>
      </Card>}
      {causes.length ? <CauseList causes={causes}/>
        : report.causes.status === 'ok' && <p className="text-[14px] text-neutral-500">Pogoda nie jest główną przyczyną.</p>}
    </Section>
  </div>;
  // analiza na dziś: najpierw to, co nadchodzi; analiza historyczna: najpierw pogoda przed datą raportu
  return <div className="flex flex-col gap-14">{isToday ? [forecast, past] : [past, forecast]}</div>;
}

/** Bilans puszczony dalej po prognozie: dzień po dniu, zapas na tle progu stresu (zsynchronizowany z oknem karuzeli). */
function ForecastTable({ days }) {
  return <Table scroll minWidth={340}>
    <Caption>Czerwony: zapas poniżej progu stresu.<span className="hidden sm:inline"> Kreska: próg stresu.</span></Caption>
    <THead><TR>
      <TH>Dzień</TH><TH className="text-right">Opad</TH><TH className="text-right">Parowanie</TH><TH className="pl-4 sm:pl-6">Zapas wody</TH>
    </TR></THead>
    <TBody>{days.map((day) => {
      const stress = day.available_pct < day.stress_threshold_pct;
      return <TR key={day.date} className={stress ? 'text-severe-ink' : undefined}>
        <TD className="num whitespace-nowrap">{dateText(day.date)}</TD>
        <TD className="num whitespace-nowrap text-right">{number(day.rain_mm, 1)} mm</TD>
        <TD className="num whitespace-nowrap text-right">{number(day.et0_mm, 1)} mm</TD>
        <TD className="pl-4 sm:pl-6">
          <div className="flex items-center gap-3">
            <span className={stress ? 'w-10 font-semibold' : 'w-10 font-semibold text-neutral-900'}>{number(day.available_pct)}%</span>
            <div aria-hidden className="hidden w-36 sm:block md:w-44">
              <Meter size="sm" value={day.available_pct} marker={day.stress_threshold_pct}
                color={stress ? 'var(--color-severe)' : 'var(--color-water-500)'} track={stress ? 'bg-severe-soft' : 'bg-water-50'}/>
            </div>
          </div>
        </TD>
      </TR>;
    })}</TBody>
  </Table>;
}

/** Opad i parowanie w oknach 30/60/90 dni: pasek = ten rok, kreska = mediana z 10 lat (wspólna skala dla wszystkich okien). */
function WeatherWindows({ windows, section }) {
  if (!windows?.length) return <Note section={section.status === 'ok' ? { status: 'no_data' } : section}
    fallback="Brak danych o opadzie i parowaniu z ostatnich 10 lat."/>;
  const max = Math.max(1, ...windows.flatMap((w) => [w.rain_mm, w.rain_median_mm ?? 0, w.et0_mm, w.et0_median_mm ?? 0]));
  // jedna siatka kolumn dla wszystkich okien (subgrid): paski mają tę samą długość toru, więc skala jest naprawdę wspólna
  return <Card className="p-5 md:p-6">
    <div aria-hidden className="mb-3 text-right text-[12px] text-neutral-500">Analiza / Zwykle</div>
    <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] gap-x-4 gap-y-7 sm:gap-x-5">
      {windows.map((w) => <div key={w.days} className="col-span-3 grid grid-cols-subgrid gap-y-3">
        <h3 className="col-span-3 font-sans text-[15px] font-semibold tracking-tight text-neutral-900">Ostatnie {w.days} dni</h3>
        <dl className="col-span-3 grid grid-cols-subgrid items-center gap-y-3">
          <CompareRow label="Opad" value={w.rain_mm} typical={w.rain_median_mm} max={max}
            color="var(--color-water-500)" track="bg-water-50"/>
          <CompareRow label="Parowanie" value={w.et0_mm} typical={w.et0_median_mm} max={max}
            color="var(--color-moderate)" track="bg-moderate-soft"/>
        </dl>
      </div>)}
    </div>
  </Card>;
}

function CompareRow({ label, value, typical, max, color, track }) {
  return <>
    <dt className="text-[13.5px] text-neutral-600">{label}</dt>
    <dd aria-hidden>
      <Meter value={100 * value / max} marker={typical != null ? 100 * typical / max : undefined} color={color} track={track}/>
    </dd>
    <dd className="num whitespace-nowrap text-right text-[13.5px] font-medium text-neutral-900">
      {number(value)} mm
      {typical != null && <span className="sr-only">, zwykle {number(typical)} mm</span>}
      <span aria-hidden className="font-normal text-neutral-400"> / {number(typical)}</span>
    </dd>
  </>;
}
