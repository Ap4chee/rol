import { useState } from 'react';
import { ArrowRight, ChevronRight, CircleAlert, Info, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Meter } from '@/components/ui/meter';
import { Segmented } from '@/components/ui/segmented';
import { Slider } from '@/components/ui/slider';
import { Spinner } from '@/components/ui/spinner';
import { StatCards } from '@/components/spectrumui/charts/stat-cards';
import { SkeletonReveal } from '@/components/spectrumui/skeleton-reveal';
import { NARROW, useMediaQuery } from '@/lib/media';
import { cn } from '@/lib/utils';
import { Field3D } from '../Field3D.jsx';
import { ParcelMap } from '../ParcelMap.jsx';
import { WaterChart } from '../WaterChart.jsx';
import { Note, Sparkline, statusFill, statusInk } from '../ui.jsx';
import { dateText, number, satelliteMeasurements, waterPercent } from '../model.js';
import { GROUPS, groupActions } from './Recommendations.jsx';
import { CauseList, Section, TAB_LABELS } from './shared.jsx';

const WATER = 'var(--color-water-500)';
const mm = (value) => `${number(value)} mm`;
// wskaźniki satelitarne zawsze z dwoma miejscami (dokładność NDVI/NDMI), żeby „0,2” i „0,61” się nie rozjeżdżały
const index2 = (value) => (Number.isFinite(value) ? value.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—');
const minus = (text) => text.replace('-', '−');   // typograficzny minus zamiast dywizu
const dayMonth = (iso) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;

function runningTotal(values) {
  let sum = 0;
  return values.map((value) => (sum += value));
}

/** Klucz legendy: przerywana kreska jak linia „zwykle” na wykresie karty. */
function DashKey() {
  return <span aria-hidden className="mr-1.5 inline-block w-3 border-t border-dashed border-neutral-400 align-middle"/>;
}

// ---------- ocena ----------

/** Nagłówek oceny z dwóch zdań (np. poza sezonem: „Uprawa nie jest w okresie wzrostu. Zapas…”): pierwsze jako kontekst
 *  drobnym drukiem, drugie dużym. Jedno zdanie zostaje w całości. */
function splitHeadline(headline) {
  const cut = headline.indexOf('. ');
  return cut > 0 && cut < headline.length - 2 ? [headline.slice(0, cut + 1), headline.slice(cut + 2)] : [null, headline];
}

function Verdict({ report, terrain, limited, onTab, intro }) {
  const water = report.water_status;
  const result = water.result;
  const stressDay = water.forecast_stress_day;
  const pct = waterPercent(result);
  const latest = water.series?.at(-1);
  // próg stresu dotyczy rosnącej uprawy; poza sezonem pokazujemy sam zapas
  const threshold = water.in_season !== false && Number.isFinite(latest?.stress_threshold_pct) ? latest.stress_threshold_pct : null;
  const actions = GROUPS.flatMap((group) => groupActions(report.recommendations, terrain?.recommendations ?? [], group.key));
  const first = actions[0];
  const [context, statement] = splitHeadline(water.headline ?? 'Brakuje danych do oceny');

  return <div className={cn('flex flex-col gap-8', intro && 'animate-rise [animation-delay:70ms] motion-reduce:animate-none')}>
    <div>
      <h2 className="eyebrow">Sytuacja wodna</h2>
      {context && <p className="mt-3 text-[15px] font-medium text-neutral-600">{context}</p>}
      <p className={cn(context ? 'mt-1.5' : 'mt-3', 'font-display font-semibold leading-[1.04] tracking-tight text-balance',
        statement.length > 48 ? 'text-[clamp(24px,2.4vw,32px)]' : 'text-[clamp(28px,3.2vw,44px)]')}
        style={{ color: statusInk(water) }}>{statement}</p>
      {result && <>
        <p className="mt-4 text-[16px] leading-relaxed text-neutral-700">
          {result.depletion_mm > 1
            ? <>Brakuje <strong className="num font-semibold text-neutral-950">{mm(result.depletion_mm)}</strong> wody do pełnego zapasu</>
            : 'Zapas wody jest pełny'}
          {pct == null && <span className="num text-neutral-500"> · {number(result.available_mm)} z {mm(result.taw_mm)}</span>}
        </p>
        {pct != null && <div className="mt-4 max-w-[440px]">
          <Meter value={pct} color={statusFill(water)} marker={threshold ?? undefined}
            label={`Zapas wody: ${number(result.available_mm)} z ${mm(result.taw_mm)}`}/>
          <div className="num mt-2.5 flex flex-wrap justify-between gap-x-4 gap-y-1 text-[12.5px] text-neutral-500">
            <span>{number(result.available_mm)} z {mm(result.taw_mm)}</span>
            {threshold != null && <span className="inline-flex items-center gap-1.5">
              <span aria-hidden className="h-3 w-[2px] rounded-full bg-neutral-900"/>próg stresu {number(threshold)}%</span>}
          </div>
        </div>}
        {stressDay && <p className="mt-4 flex items-center gap-1.5 text-[14px] font-semibold text-severe-ink">
          <CircleAlert aria-hidden className="size-4 shrink-0" strokeWidth={2.25}/>Stres wodny od {dateText(stressDay)}</p>}
      </>}
      <Note section={water} className="mt-4"/>
    </div>

    {first && <Card className="p-5">
      <p className="eyebrow flex items-center gap-2"><span aria-hidden className="size-1.5 rounded-full bg-brand-600"/>Najważniejsze teraz</p>
      <p className="mt-2.5 text-[17px] font-semibold leading-snug tracking-tight text-neutral-950">{first.title}</p>
      {first.what && <p className="mt-1.5 line-clamp-2 text-[13.5px] leading-relaxed text-neutral-600">{first.what}</p>}
      <Button variant="link" size="inline" className="press no-print mt-3 text-[13.5px]" iconRight={<ArrowRight className="size-3.5"/>}
        onClick={() => onTab('rekomendacje')}>
        {actions.length > 1 ? `Wszystkie działania (${actions.length})` : 'Szczegóły działania'}
      </Button>
    </Card>}

    {limited && <button type="button" onClick={() => onTab('zrodla')}
      className="press -my-1 inline-flex items-center gap-1.5 self-start rounded-md py-1 text-[13px] text-neutral-500 hover:text-neutral-900">
      <Info aria-hidden className="size-4"/>Ograniczona pewność wyniku<ArrowRight aria-hidden className="size-3.5"/>
    </button>}
  </div>;
}

/** Model 3D pola z glebą albo zdjęcie lotnicze z drogami spływu. Do wydruku zawsze model 3D. */
function FieldView({ report, terrain, printing, intro }) {
  const [view, setView] = useState('3d');
  const narrow = useMediaQuery(NARROW);   // na telefonie niższa scena: model jest wąski, pełne 420 px to pusta przestrzeń
  const viewSwitch = <Segmented className="no-print" label="Widok działki" value={view} onChange={setView}
    options={[{ value: '3d', label: 'Pole i gleba' }, { value: 'map', label: 'Zdjęcie lotnicze' }]}/>;
  // przełącznik widoku i „Złóż warstwy” w jednym pasku nad modelem
  return <div className="min-w-0">
    {view === '3d' || printing
      ? <Field3D report={report} cropArea={report.test_crop_area} height={narrow ? 300 : 420} toolbar={viewSwitch} intro={intro}/>
      : <><div className="mb-2">{viewSwitch}</div>
        <ParcelMap parcel={report.parcel} point={report.parcel ? null : report.request.point} terrain={terrain}/></>}
  </div>;
}

// ---------- zapas wody ----------

/**
 * Cztery liczby pod wykresem. Wykresy w kartach to sumy narastające z dziennych wartości bilansu z tego samego okna,
 * co liczba (oba kończą się na ostatnim dniu z danymi); bez zmiany procentowej, bo od zera nic by nie znaczyła.
 */
function factCards(report) {
  const water = report.water_status;
  const series = water.series ?? [];
  const rain = report.causes.windows?.find((w) => w.days === 30);
  const climat = water.climatic_water_balance;
  const history = report.history;
  const need = report.irrigation_need;

  const rainDays = rain && series.length >= 30 ? series.slice(-30) : [];
  const rainSeries = rainDays.length === 30 && rainDays.every((d) => Number.isFinite(d.rain_mm));
  const balanceDays = climat?.days > 1 && series.length >= climat.days ? series.slice(-climat.days) : [];
  const balanceSeries = balanceDays.length > 1 && balanceDays.every((d) => Number.isFinite(d.rain_mm) && Number.isFinite(d.et0_mm));

  // odcinki: jeden na pełny sezon; tylko gdy zgadzają się z liczbą (inaczej sam pasek udziału)
  const seasons = (history.seasons ?? []).filter((s) => s.complete !== false);
  const segments = history.seasons_total > 0 && seasons.length === history.seasons_total
    && seasons.filter((s) => s.stressed).length === history.seasons_with_stress;

  const typical = (median, drawn) => (median == null ? null : <>{drawn && <DashKey/>}zwykle {minus(mm(median))}</>);

  return [
    {
      label: 'Opad, 30 dni', value: rain?.rain_mm ?? null, unit: 'mm', format: (v) => number(v), delta: false,
      series: rainSeries ? runningTotal(rainDays.map((d) => d.rain_mm)) : undefined, min: 0,
      reference: rainSeries ? rain.rain_median_mm ?? null : null, color: WATER,
      pointLabel: (i) => `suma do ${dayMonth(rainDays[i].date)}`,
      caption: typical(rain?.rain_median_mm, rainSeries),
    },
    {
      label: `Opad minus parowanie, ${climat?.days ?? 60} dni`, value: climat?.balance_mm ?? null, unit: 'mm',
      format: (v) => minus(number(v)), delta: false,
      series: balanceSeries ? runningTotal(balanceDays.map((d) => d.rain_mm - d.et0_mm)) : undefined,
      reference: balanceSeries ? climat.median_10y_mm ?? null : null, color: WATER,
      pointLabel: (i) => `suma do ${dayMonth(balanceDays[i].date)}`,
      caption: typical(climat?.median_10y_mm, balanceSeries),
    },
    {
      label: 'Sezony z niedoborem', value: history.seasons_total ? history.seasons_with_stress : null,
      unit: history.seasons_total ? `z ${history.seasons_total}` : undefined, format: (v) => number(v), delta: false,
      segments: segments ? seasons.map((s) => ({ active: s.stressed, label: `${s.season}: ${s.stressed ? 'niedobór' : 'bez niedoboru'}` })) : undefined,
      segmentEnds: segments ? [seasons[0].season, seasons.at(-1).season] : undefined,
      progress: !segments && history.seasons_total ? history.seasons_with_stress / history.seasons_total : undefined,
      color: 'var(--color-moderate)', caption: 'ostatnie pełne sezony',
    },
    {
      label: 'Nawadnianie w typowym sezonie', value: need?.typical_mm ?? null, unit: 'mm', format: (v) => number(v), delta: false,
      caption: need?.dry_mm != null ? `w suchym roku ${mm(need.dry_mm)}` : null,
    },
  ];
}

function WaterReserve({ report, intro }) {
  const water = report.water_status;
  const series = water.series ?? [];
  const forecastNote = water.forecast_reason && !water.forecast?.length
    ? <p className="mt-3 text-[12.5px] leading-relaxed text-neutral-500">{water.forecast_reason}</p> : null;
  return <Section title="Zapas wody w glebie" lead="Woda dostępna dla roślin w strefie korzeni, dzień po dniu, na tle tych samych dni z 10 lat.">
    {series.length > 1
      ? <Card className="px-0 py-4 sm:p-5">
        <WaterChart series={series} forecast={water.forecast ?? []} color={statusFill(water)} intro={intro}/>
        {forecastNote && <div className="px-4 sm:px-0">{forecastNote}</div>}
      </Card>
      : <>
        {water.status === 'ok'
          ? <p className="text-[14px] text-neutral-500">Za mało dni, żeby narysować przebieg zapasu.</p>
          : <Note section={water}/>}
        {forecastNote}
      </>}
    <StatCards className="mt-3" columns={2} intro={intro} cards={factCards(report)}/>
  </Section>;
}

// ---------- przyczyny ----------

function Causes({ report, terrain, onTab }) {
  const causes = [...(report.causes.items ?? []), ...(terrain?.causes ?? [])];
  return <Section title="Dlaczego?" aside={<div className="no-print flex flex-wrap gap-1">
    {['pogoda', 'gleba', 'teren'].map((key) => <Button key={key} variant="ghost" size="xs" onClick={() => onTab(key)}
      iconRight={<ChevronRight aria-hidden className="-ml-1 text-neutral-400"/>}>{TAB_LABELS[key]}</Button>)}
  </div>}>
    <Note section={report.causes}/>
    {causes.length > 0 ? <CauseList causes={causes} limit={3}/>
      : report.causes.status === 'ok' && <p className="text-[14px] leading-relaxed text-neutral-500">
        {report.causes.reason || 'Raport nie wskazuje wyraźnej przyczyny niedoboru.'}</p>}
  </Section>;
}

// ---------- zieloność roślin ----------

function GreennessSkeleton() {
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

function Greenness({ satellite, failed, retry, canRetry, printing }) {
  const measurements = satelliteMeasurements(satellite);
  const [index, setIndex] = useState(null);
  const pending = satellite.status === 'pending';
  // szkielet tylko, gdy nic jeszcze nie przyszło; wczytane już zdjęcia widać od razu (serwer może odpowiadać „pending”)
  const loading = pending && !printing && measurements.length === 0;
  const last = measurements.length - 1;
  const current = index != null && index <= last ? index : last;
  const observation = measurements[current];

  return <Section title="Zieloność roślin" lead="Ze zdjęć satelitarnych Sentinel-2: im wyższy NDVI, tym więcej zielonych roślin.">
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
  </Section>;
}

// ---------- podsumowanie ----------

/**
 * Zakładka „Podsumowanie”: ocena i model pola, zapas wody z liczbami, przyczyny i zieloność roślin.
 * `intro`: wejście (ocena, karty liczb) tylko przy pierwszym pokazaniu raportu, nie przy powrocie na zakładkę.
 */
export function Summary({ report, terrain, satellite, sat, limited, onTab, printing, intro = false }) {
  return <div className="flex flex-col gap-14">
    <div className="grid gap-10 md:grid-cols-12 md:items-center md:gap-12">
      <div className="md:col-span-5"><Verdict report={report} terrain={terrain} limited={limited} onTab={onTab} intro={intro}/></div>
      <div className="min-w-0 md:col-span-7"><FieldView report={report} terrain={terrain} printing={printing} intro={intro}/></div>
    </div>
    <WaterReserve report={report} intro={intro}/>
    <div className="grid gap-14 md:grid-cols-12 md:gap-12">
      <div className="min-w-0 md:col-span-7"><Causes report={report} terrain={terrain} onTab={onTab}/></div>
      <div className="min-w-0 md:col-span-5"><Greenness satellite={satellite} failed={sat.failed} retry={sat.retry}
        canRetry={sat.canRetry} printing={printing}/></div>
    </div>
  </div>;
}
