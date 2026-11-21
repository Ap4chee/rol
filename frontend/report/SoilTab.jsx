import { Field3D } from '../Field3D.jsx';
import { mergeSoilLayers, number } from '../model.js';
import { Note } from '../ui.jsx';
import { Card } from '@/components/ui/card';
import { Meter } from '@/components/ui/meter';
import { Caption, Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { NARROW, useMediaQuery } from '@/lib/media';
import { cn } from '@/lib/utils';
import { Section } from './shared.jsx';

// Frakcje uziarnienia: pole warstwy, nazwa, kolor z @theme (app.css).
const FRACTIONS = [['sand_pct', 'piasek', 'bg-sand'], ['silt_pct', 'pył', 'bg-silt'], ['clay_pct', 'ił', 'bg-clay']];
const DRY = new Set(['low', 'very_low']);

/** Zakładka „Gleba”: model 3D pola, profil gleby i wilgotność warstw w okolicy. */
export function SoilTab({ report, printing }) {
  const { soil, soil_moisture: moisture, crop } = report;
  const rootCm = (soil.root_depth_m ?? crop.root_depth_m ?? 0) * 100;
  const regional = moisture?.status === 'ok' ? moisture.layers ?? [] : [];
  const layers = mergeSoilLayers(soil.layers);   // te same klasy gleby obok siebie jako jedna warstwa, jak w modelu 3D
  const narrow = useMediaQuery(NARROW);   // na telefonie niższa scena (model jest wąski)
  return <div className="flex flex-col gap-14">
    {!printing && <Field3D report={report} cropArea={report.test_crop_area} height={narrow ? 320 : 480}/>}
    <div className="grid gap-12 lg:grid-cols-12">
      <Section title="Profil gleby" className="lg:col-span-7">
        <Note section={soil}/>
        {layers.length > 0 && <SoilProfile layers={layers} rootCm={rootCm}/>}
      </Section>
      <Section title="Wilgotność w okolicy" className="lg:col-span-5">
        {regional.length ? <RegionalMoisture layers={regional}/>
          : <Note section={moisture && moisture.status !== 'ok' ? moisture : { status: 'no_data' }}
            fallback="Brak danych o wilgotności warstw w okolicy."/>}
      </Section>
    </div>
  </div>;
}

/** Warstwy gleby: głębokość z paskiem położenia w profilu, uziarnienie, woda dostępna, pojemność polowa.
 *  Warstwy od głębokości korzeni w dół są wyszarzone (bilans ich nie liczy). */
function SoilProfile({ layers, rootCm }) {
  const depthCm = Math.max(1, layers.at(-1).bottom_cm);
  const maxWater = Math.max(1, ...layers.map((layer) => layer.available_water_mm ?? 0));
  const deeper = rootCm > 0 && layers.some((layer) => layer.top_cm >= rootCm);
  return <Table>
    <Caption className="pt-3.5"><SoilLegend rootCm={rootCm} deeper={deeper}/></Caption>
    <THead><TR>
      <TH>Warstwa</TH><TH>Gleba</TH><TH>Woda dostępna</TH><TH className="text-right">Pojemność polowa</TH>
    </TR></THead>
    <TBody>{layers.map((layer) => {
      const reached = layer.top_cm < rootCm;
      return <TR key={layer.top_cm} className={reached ? undefined : 'text-neutral-400'}>
        <TD className="py-3">
          <div className="flex items-start gap-3">
            <DepthRail layer={layer} depthCm={depthCm} rootCm={rootCm} reached={reached}/>
            <span className={cn('whitespace-nowrap font-medium', reached && 'text-neutral-900')}>{layer.top_cm}–{layer.bottom_cm} cm</span>
          </div>
        </TD>
        <TD className="py-3">
          {layer.texture_label}
          <Texture layer={layer} reached={reached}/>
        </TD>
        <TD className="py-3">
          <span className={cn('whitespace-nowrap font-medium', reached && 'text-neutral-900')}>{number(layer.available_water_mm)} mm</span>
          <span aria-hidden className="mt-1.5 block h-1 w-16">
            <span className={cn('block h-full rounded-full', reached ? 'bg-water-500' : 'bg-water-200')}
              style={{ width: `${Math.max(6, 100 * (layer.available_water_mm ?? 0) / maxWater)}%` }}/>
          </span>
        </TD>
        <TD className="py-3 text-right">{number(layer.field_capacity_vol_pct)}%</TD>
      </TR>;
    })}</TBody>
  </Table>;
}

/** Miejsce warstwy w profilu: pasek od powierzchni (góra) do dna profilu; zielona kreska to głębokość korzeni w bilansie. */
function DepthRail({ layer, depthCm, rootCm, reached }) {
  const top = 100 * layer.top_cm / depthCm;
  const height = 100 * (layer.bottom_cm - layer.top_cm) / depthCm;
  const root = 100 * rootCm / depthCm;
  return <span aria-hidden className="relative mt-0.5 block h-8 w-1.5 shrink-0 rounded-full bg-black/[0.07]">
    <span className={cn('absolute inset-x-0 rounded-full', reached ? 'bg-neutral-700' : 'bg-neutral-300')}
      style={{ top: `${top}%`, height: `max(4px, ${height}%)` }}/>
    {root > 0 && root < 100 && <span className="absolute -left-[3px] h-0.5 w-3 -translate-y-1/2 rounded-full bg-brand-500 ring-2 ring-white"
      style={{ top: `${root}%` }}/>}
  </span>;
}

/** Uziarnienie warstwy jako cienki pasek (piasek · pył · ił); dokładne udziały w dymku i dla czytnika ekranu. */
function Texture({ layer, reached }) {
  if (!FRACTIONS.every(([key]) => Number.isFinite(layer[key]))) return null;
  const parts = FRACTIONS.filter(([key]) => layer[key] > 0);
  const shares = FRACTIONS.map(([key, name]) => `${name} ${number(layer[key])}%`);
  return <>
    <span aria-hidden title={shares.join(' · ')} className={cn('mt-1.5 flex h-1 w-16 gap-0.5', !reached && 'opacity-40')}>
      {parts.map(([key, , color]) => <span key={key} className={cn('h-full basis-0 rounded-full', color)} style={{ flexGrow: layer[key] }}/>)}
    </span>
    <span className="sr-only">: {shares.join(', ')}</span>
  </>;
}

function SoilLegend({ rootCm, deeper }) {
  return <span className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
    <span className="inline-flex items-center gap-3">
      {FRACTIONS.map(([key, name, color]) => <span key={key} className="inline-flex items-center gap-1.5">
        <span aria-hidden className={cn('h-1 w-3 rounded-full', color)}/>{name}
      </span>)}
    </span>
    {rootCm > 0 && <span className="inline-flex items-center gap-1.5">
      <span aria-hidden className="h-0.5 w-3 rounded-full bg-brand-500"/>strefa korzeni do {number(rootCm)} cm
    </span>}
    {deeper && <span>szare wiersze: poniżej strefy korzeni</span>}
  </span>;
}

/** Wilgotność warstw z modelu regionalnego (okolica działki): pasek = teraz, kreska = mediana z 10 lat. */
function RegionalMoisture({ layers }) {
  return <Card className="p-5 md:p-6">
    <ul className="flex flex-col gap-6">
      {layers.map((layer) => {
        const dry = DRY.has(layer.class_key);
        return <li key={layer.key}>
          <div className="flex items-baseline justify-between gap-3">
            <p className="min-w-0 text-[14px] font-medium text-neutral-900 first-letter:uppercase">{layer.label}</p>
            <p className="num shrink-0 text-[12px] text-neutral-500">
              {layer.bottom_cm == null ? 'cały profil' : `${layer.top_cm}–${layer.bottom_cm} cm`}</p>
          </div>
          <Meter className="mt-3" size="lg" value={100 * layer.current} marker={100 * layer.median} label={`Wilgotność: ${layer.label}`}
            color={dry ? 'var(--color-moderate)' : 'var(--color-water-500)'} track={dry ? 'bg-moderate-soft' : 'bg-water-50'}/>
          <p className={cn('mt-2.5 text-[12.5px]', dry ? 'font-semibold text-moderate-ink' : 'text-neutral-500')}>{layer.class_label}</p>
        </li>;
      })}
    </ul>
    <p className="mt-6 text-[12px] text-neutral-500">Pasek: teraz · kreska: zwykle (10 lat) · NASA POWER, ok.&nbsp;50&nbsp;km</p>
  </Card>;
}
