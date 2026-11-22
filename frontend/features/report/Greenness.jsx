import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { dateText } from '@/shared/format/date';
import { Button } from '@/shared/ui/button';
import { Callout } from '@/shared/ui/callout';
import { Card } from '@/shared/ui/card';
import { SkeletonReveal } from '@/shared/ui/effects';
import { Note, Paragraphs } from '@/shared/ui/note';
import { Section } from '@/shared/ui/section';
import { Slider } from '@/shared/ui/slider';
import { Sparkline } from '@/shared/ui/sparkline';
import { Spinner } from '@/shared/ui/spinner';
import { satelliteMeasurements } from './logic.js';
import { index2, NdmiForecast } from './NdmiForecast.jsx';

export function GreennessSkeleton() {
  return <div>
    <div className="flex gap-8">
      <div><div className="h-3 w-24 rounded bg-black/[0.06]"/><div className="mt-2.5 h-7 w-16 rounded-md bg-black/[0.07]"/></div>
      <div><div className="h-3 w-28 rounded bg-black/[0.06]"/><div className="mt-2.5 h-5 w-12 rounded-md bg-black/[0.06]"/></div>
    </div>
    <div className="mt-5 h-14 rounded-lg bg-black/[0.04]"/>
    <div className="mt-3 h-1.5 rounded-full bg-black/[0.06]"/>
  </div>;
}

function Readout({ observation }) {
  return <div className="flex flex-wrap items-start gap-x-8 gap-y-3">
    <div>
      <p className="text-[12.5px] text-neutral-500">Zieloność (NDVI)</p>
      <p className="num mt-1.5 text-[28px] font-medium leading-none tracking-tight text-neutral-950">{index2(observation.ndvi)}</p>
    </div>
    {Number.isFinite(observation.ndmi) && <div>
      <p className="text-[12.5px] text-neutral-500">Uwilgotnienie (NDMI)</p>
      <p className="num mt-1.5 text-[19px] font-medium leading-none tracking-tight text-neutral-700">{index2(observation.ndmi)}</p>
    </div>}
  </div>;
}

/** NDVI w kolejnych zdjęciach z kropką na wybranym zdjęciu (geometria jak w <Sparkline>: viewBox 160×44, skala 0–1). */
function Trend({ measurements, current, onChange }) {
  const n = measurements.length;
  const left = `${((3 + (154 * current) / (n - 1)) / 160) * 100}%`;
  const top = `${((39 - 34 * measurements[current].ndvi) / 44) * 100}%`;
  return <div className="mt-5">
    <div className="relative text-brand-600">
      <span aria-hidden className="absolute inset-y-0 w-px -translate-x-1/2 bg-neutral-200" style={{ left }}/>
      <Sparkline className="relative" values={measurements.map((o) => o.ndvi)} min={0} max={1} height={56}
        label="Zieloność roślin (NDVI) w kolejnych zdjęciach satelitarnych"/>
      <span aria-hidden className="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-brand-600 shadow-[0_0_0_1px_rgb(14_16_13/0.14)]"
        style={{ left, top }}/>
    </div>
    {/* cieńszy tor niż domyślny: suwak tylko przewija zdjęcia, nie powinien przykrywać wykresu */}
    <Slider className="no-print mt-2 [&>span:first-child]:h-1 [&>span:first-child>span]:bg-brand-600" min={0} max={n - 1} step={1}
      value={current} onChange={onChange} label="Wybierz zdjęcie satelitarne"
      valueText={(i) => `zdjęcie ${i + 1} z ${n}, ${dateText(measurements[i].date)}`}/>
  </div>;
}

export function Greenness({ satellite, failed, retry, canRetry, printing }) {
  const measurements = satelliteMeasurements(satellite);
  const [index, setIndex] = useState(null);
  const pending = satellite.status === 'pending';
  // szkielet tylko, gdy nic jeszcze nie przyszło; wczytane już zdjęcia widać od razu (serwer może odpowiadać „pending”)
  const loading = pending && !printing && measurements.length === 0;
  const last = measurements.length - 1;
  const current = index != null && index <= last ? index : last;
  const observation = measurements[current];
  const forecast = satellite.ndmi_forecast;

  return <Section title="Rośliny z satelity"
    lead="Zdjęcia Sentinel-2: NDVI to zieloność roślin, NDMI wskazuje uwilgotnienie roślin. Sprawdzamy, czy zgadzają się z bilansem.">
    {pending && <p role="status" className="mb-3 flex items-center gap-2 text-[13.5px] text-neutral-500">
      <Spinner className="size-3.5"/>Wczytuję zdjęcia Sentinel-2…</p>}
    {!pending && satellite.status !== 'ok' && <div role={satellite.status === 'error' ? 'alert' : undefined} className="mb-3">
      <Note section={satellite} fallback="Brak obserwacji." className="my-0"/>
      {/* ponów także po błędzie zgłoszonym przez serwer (np. STAC nie odpowiedział), nie tylko po zerwanym połączeniu */}
      {(failed || satellite.status === 'error') && canRetry
        && <Button variant="secondary" size="sm" icon={<RefreshCw/>} onClick={retry} className="no-print mt-3">Ponów</Button>}
    </div>}
    {(loading || measurements.length > 0) && <Card className="p-5">
      <SkeletonReveal loading={loading} pulseCount="infinite" skeleton={<GreennessSkeleton/>}
        className={loading && measurements.length < 2 ? 'min-h-[132px]' : undefined}>
        {observation && <Readout observation={observation}/>}
        {measurements.length > 1 && <Trend measurements={measurements} current={current} onChange={setIndex}/>}
        {observation && <p className="mt-3 flex flex-wrap justify-between gap-x-4 gap-y-1 text-[12.5px] text-neutral-500">
          <span><span className="num">{dateText(observation.date)}</span> · Sentinel-2</span>
          {measurements.length > 1 && <span className="num">zdjęcie {current + 1} z {measurements.length}</span>}
        </p>}
      </SkeletonReveal>
    </Card>}
    {!pending && satellite.status === 'ok' && measurements.length === 0
      && <p className="text-[14px] text-neutral-500">Brak obserwacji.</p>}
    <SatelliteReading satellite={satellite} measured={measurements.length > 0}/>
    {forecast && !loading && <NdmiForecast forecast={forecast}/>}
  </Section>;
}

// Zgodność zdjęć z bilansem (serwer: satellite.agreement) → ton i tytuł ramki z wnioskiem.
const AGREEMENT = {
  confirms: ['ok', 'Zdjęcia potwierdzają bilans'],
  diverges: ['warning', 'Zdjęcia nie zgadzają się z bilansem'],
  inconclusive: ['neutral', 'Zdjęcia nie rozstrzygają'],
};

/** Wniosek ze zdjęć policzony na serwerze: czy wskaźniki potwierdzają bilans, z datami i wartościami. */
function SatelliteReading({ satellite, measured }) {
  const lines = satellite.text ?? [];
  if (!lines.length) return null;
  // bez czystego zdjęcia (chmury, mała działka) zostają uwagi bez oceny zgodności
  if (!measured) return <div className="mt-3 text-[13px] leading-relaxed text-neutral-500"><Paragraphs lines={lines}/></div>;
  const [tone, title] = AGREEMENT[satellite.agreement] ?? AGREEMENT.inconclusive;
  return <Callout tone={tone} title={title} className="mt-3 leading-relaxed"><Paragraphs lines={lines}/></Callout>;
}

