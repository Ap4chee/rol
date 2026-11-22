import { useState } from 'react';
import { ArrowRight, ChevronRight, CircleAlert, RefreshCw, Sparkles } from 'lucide-react';
import { Button } from '@/shared/ui/button';
import { Callout } from '@/shared/ui/callout';
import { Card } from '@/shared/ui/card';
import { Meter } from '@/shared/ui/meter';
import { Slider } from '@/shared/ui/slider';
import { Spinner } from '@/shared/ui/spinner';
import { StatusBadge, TONE } from '@/shared/ui/status';
import { StatCards } from '@/shared/vendor/spectrumui/charts/stat-cards';
import { SkeletonReveal } from '@/shared/vendor/spectrumui/skeleton-reveal';
import { cn } from '@/shared/lib/cn';
import { WaterChart } from '../WaterChart.jsx';
import { BUCKET_IMAGES } from '../Dashboard.jsx';
import { Note, Paragraphs, Sparkline, statusFill, statusTone } from '../ui.jsx';
import { dateText, firstAction, number, satelliteMeasurements, stressSeasons, waterPercent } from '../model.js';
import { actionArt, GROUPS, groupActions, Irrigation } from './Recommendations.jsx';
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

const ACTION_EYEBROW = { now: 'Najważniejsze teraz', after_harvest: 'Najbliższe działanie: po zbiorze', long_term: 'Na kolejne sezony' };

function Verdict({ report, terrain, limited, onTab, intro }) {
  const water = report.water_status;
  const result = water.result;
  const stressDay = water.forecast_stress_day;
  const pct = waterPercent(result);
  const latest = water.series?.at(-1);
  // próg stresu dotyczy rosnącej uprawy; poza sezonem pokazujemy sam zapas
  const threshold = water.in_season !== false && Number.isFinite(latest?.stress_threshold_pct) ? latest.stress_threshold_pct : null;
  // zapas dla gleby lżejszej i cięższej (kwantyle SoilGrids), pokazany jako ramka na pasku
  const variantPcts = (water.variants ?? []).map(waterPercent).filter((value) => value != null);
  const range = variantPcts.length > 1 ? [Math.min(...variantPcts), Math.max(...variantPcts)] : null;
  const actions = GROUPS.flatMap((group) => groupActions(report.recommendations, terrain?.recommendations ?? [], group.key)
    .map((item) => ({ ...item, group: group.key })));
  const first = firstAction(actions.filter((item) => item.group !== 'irrigation'))
    ?? firstAction(actions);
  const art = first && actionArt(first.key, first.group);
  const [context, statement] = splitHeadline(water.headline ?? 'Brakuje danych do oceny');
  const tone = TONE[statusTone(water)];
  const stateImage = BUCKET_IMAGES[water.status === 'ok' ? water.class_key : 'unknown'] ?? 'brak';

  // jedna karta: ocena z lewej (ilustracja stanu, tło w kolorze stanu), najważniejsze działanie z obrazkiem z prawej
  return <section className={cn('surface overflow-hidden md:grid', first && 'md:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]',
    intro && 'animate-rise [animation-delay:70ms] motion-reduce:animate-none')}>
    <div className="flex flex-col p-6 md:p-8" style={{ backgroundImage: `linear-gradient(135deg, ${tone.soft} 0%, transparent 60%)` }}>
      <div className="flex items-center gap-4">
        {/* ilustracje stanu z /design, te same co w „Stanie wody na polach” na pulpicie */}
        <img src={`/design/stan-${stateImage}.png`} alt="" width="112" height="112" decoding="async"
          className="size-16 shrink-0 drop-shadow-[0_8px_10px_rgba(0,0,0,0.12)] md:size-[72px]"/>
        <div className="min-w-0">
          <h2 className="eyebrow">Sytuacja wodna</h2>
          {context && <p className="mt-1 text-[14px] text-neutral-600">{context}</p>}
        </div>
      </div>
      <p className={cn('mt-5 font-display font-semibold leading-[1.08] tracking-tight text-balance text-neutral-950',
        statement.length > 48 ? 'text-[clamp(22px,2.2vw,28px)]' : 'text-[clamp(26px,2.6vw,34px)]')}>{statement}</p>
      {result && <>
        <p className="mt-4 text-[16px] leading-relaxed text-neutral-700">
          {result.depletion_mm > 1
            ? <>Brakuje <strong className="num font-semibold text-neutral-950">{mm(result.depletion_mm)}</strong> wody do pełnego zapasu</>
            : 'Zapas wody jest pełny'}
          {pct == null && <span className="num text-neutral-500"> · {number(result.available_mm)} z {mm(result.taw_mm)}</span>}
        </p>
        {pct != null && <div className="mt-4 max-w-[480px]">
          <Meter value={pct} color={statusFill(water)} marker={threshold ?? undefined} range={range ?? undefined}
            label={`Zapas wody: ${number(result.available_mm)} z ${mm(result.taw_mm)}`}/>
          <div className="num mt-2.5 flex flex-wrap justify-between gap-x-4 gap-y-1 text-[12.5px] text-neutral-500">
            <span>{number(result.available_mm)} z {mm(result.taw_mm)}</span>
            {range && <span className="inline-flex items-center gap-1.5">
              <span aria-hidden className="h-3 w-4 rounded-[3px] border border-neutral-900/35 bg-neutral-900/[0.05]"/>
              inna gleba: {number(range[0])}–{number(range[1])}%</span>}
            {threshold != null && <span className="inline-flex items-center gap-1.5">
              <span aria-hidden className="h-3 w-[2px] rounded-full bg-neutral-900"/>próg stresu {number(threshold)}%</span>}
          </div>
        </div>}
        {stressDay && <p className="mt-4 flex items-center gap-1.5 text-[14px] font-semibold text-severe-ink">
          <CircleAlert aria-hidden className="size-4 shrink-0" strokeWidth={2.25}/>Stres wodny od {dateText(stressDay)}</p>}
      </>}
      <Note section={water} className="mt-4"/>
    </div>

    {first && <div className="flex flex-col border-t border-black/[0.06] bg-neutral-50/70 p-5 md:border-l md:border-t-0 md:p-6">
      {/* zdjęcie zabiegu kadrowane na całą szerokość; ilustracja grupy cała, na jasnym tle */}
      <div aria-hidden className={cn('grid aspect-[16/7] place-items-center overflow-hidden rounded-xl ring-1 ring-inset ring-black/[0.05]',
        !art.photo && 'bg-white')}>
        <img src={art.src} alt="" width={art.photo ? 472 : 96} height={art.photo ? 288 : 96} decoding="async"
          className={art.photo ? 'size-full object-cover' : 'size-24 object-contain drop-shadow-[0_8px_10px_rgba(0,0,0,0.12)]'}/>
      </div>
      <p className="eyebrow mt-5">{ACTION_EYEBROW[first.timing] ?? 'Pierwsze działanie'}</p>
      <p className="mt-1.5 text-[17px] font-semibold leading-snug tracking-tight text-neutral-950">{first.title}</p>
      {first.what && <p className="mt-1.5 line-clamp-3 text-[13.5px] leading-relaxed text-neutral-600">{first.what}</p>}
      <Button variant="link" size="inline" className="press no-print mt-auto self-start pt-4 text-[13.5px]" iconRight={<ArrowRight className="size-3.5"/>}
        onClick={() => onTab('rekomendacje')}>
        {actions.length > 1 ? `Wszystkie działania (${actions.length})` : 'Szczegóły działania'}
      </Button>
    </div>}
  </section>;
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

  const rainDays = rain && series.length >= 30 ? series.slice(-30) : [];
  const rainSeries = rainDays.length === 30 && rainDays.every((d) => Number.isFinite(d.rain_mm));
  const balanceDays = climat?.days > 1 && series.length >= climat.days ? series.slice(-climat.days) : [];
  const balanceSeries = balanceDays.length > 1 && balanceDays.every((d) => Number.isFinite(d.rain_mm) && Number.isFinite(d.et0_mm));

  // odcinki: jeden na pełny sezon; tylko gdy zgadzają się z liczbą (inaczej sam pasek udziału)
  const seasons = (history.seasons ?? []).filter((s) => s.complete !== false);
  const stress = stressSeasons(history);
  const segments = history.seasons_total > 0 && seasons.length === history.seasons_total
    && seasons.filter(stress.isStressed).length === stress.count;

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
      baseline: 0, belowColor: 'var(--color-watch)', // nad zerem gleba się nawadnia, pod zerem przesycha
      pointLabel: (i) => `suma do ${dayMonth(balanceDays[i].date)}`,
      caption: typical(climat?.median_10y_mm, balanceSeries),
    },
    {
      label: stress.long ? 'Sezony z długim niedoborem' : 'Sezony z niedoborem',
      value: history.seasons_total ? stress.count : null,
      unit: history.seasons_total ? `z ${history.seasons_total}` : undefined, format: (v) => number(v), delta: false,
      segments: segments ? seasons.map((s) => ({ active: stress.isStressed(s),
        label: `${s.season}: ${s.stress_days_critical} ${s.stress_days_critical === 1 ? 'dzień' : 'dni'} niedoboru` })) : undefined,
      segmentEnds: segments ? [seasons[0].season, seasons.at(-1).season] : undefined,
      progress: !segments && history.seasons_total ? stress.count / history.seasons_total : undefined,
      color: 'var(--color-moderate)',
      caption: stress.long ? `co najmniej ${stress.long} dni niedoboru` : 'ostatnie pełne sezony',
    },
  ];
}

function WaterReserve({ report, intro }) {
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

// ---------- przyczyny ----------

function Causes({ report, terrain, onTab }) {
  const causes = [...(report.causes.items ?? []), ...(terrain?.causes ?? [])];
  return <Section title="Dlaczego?" aside={<div className="no-print flex flex-wrap gap-1">
    {['pogoda', 'gleba', 'teren'].map((key) => <Button key={key} variant="ghost" size="xs" onClick={() => onTab(key)}
      iconRight={<ChevronRight aria-hidden className="-ml-1 text-neutral-400"/>}>{TAB_LABELS[key]}</Button>)}
  </div>}>
    <Note section={report.causes}/>
    {causes.length > 0 ? <CauseList causes={causes}/>
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

// Kierunek prognozy (serwer: ndmi_forecast.trend) → ton i zdanie dla rolnika.
const TREND = {
  down: ['watch', 'Rośliny prawdopodobnie zaczną tracić wodę'],
  flat: ['unknown', 'Nie widać wyraźnego kierunku zmiany'],
  up: ['ok', 'Woda w liściach prawdopodobnie przybędzie'],
};

/**
 * Prognoza modelu ML: zmiana NDMI za 7–14 dni z przedziałem 80% na osi „spadek – bez zmiany – wzrost”.
 * Oś jest symetryczna wokół zera i obejmuje cały przedział (co najmniej ±0,15).
 */
function NdmiForecast({ forecast }) {
  const header = <div className="flex flex-wrap items-center justify-between gap-2">
    <p className="text-[14.5px] font-semibold text-neutral-900">Prognoza na 1–2 tygodnie</p>
    <StatusBadge tone="info" size="sm" icon={Sparkles}>model ML · {forecast.status ?? 'eksperymentalny'}</StatusBadge>
  </div>;
  if (!forecast.available) return <Card className="mt-3 p-5">
    {header}
    <p className="mt-2 text-[13px] leading-relaxed text-neutral-500">Prognozy nie ma: {forecast.reason ?? 'brak danych wejściowych'}.</p>
  </Card>;

  const { delta_p10: lo, delta_p50: mid, delta_p90: hi, ndmi_last: base } = forecast;
  const [tone, statement] = TREND[forecast.trend] ?? ['unknown', forecast.text?.[0]];
  const t = TONE[tone];
  const span = Math.max(0.15, Math.abs(lo), Math.abs(hi)) * 1.15;
  const x = (value) => `${50 + 50 * value / span}%`;
  const after = (delta) => index2(base + delta);
  return <Card className="mt-3 p-5">
    {header}
    <p className="mt-3 text-[16px] font-semibold leading-snug tracking-tight" style={{ color: t.ink }}>{statement}</p>
    <p className="num mt-1 text-[12.5px] text-neutral-500">
      {dateText(forecast.window_from)}–{dateText(forecast.window_to)} · względem zdjęcia z {dateText(forecast.last_scene_date)}</p>
    <div role="img" className="mt-5" aria-label={`Prognozowana zmiana NDMI ${minus(index2(mid))}, przedział 80% od ${minus(index2(lo))} do ${minus(index2(hi))}.`}>
      <div className="relative h-6">
        <span aria-hidden className="absolute inset-x-0 top-1/2 h-px bg-neutral-200"/>
        <span aria-hidden className="absolute inset-y-0 left-1/2 w-px bg-neutral-400"/>
        <span aria-hidden className="absolute top-1/2 h-3 -translate-y-1/2 rounded-full"
          style={{ left: x(lo), width: `calc(${x(hi)} - ${x(lo)})`, background: t.soft, boxShadow: `inset 0 0 0 1px ${t.fill}` }}/>
        <span aria-hidden className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgb(14_16_13/0.14)]"
          style={{ left: x(mid), background: t.fill }}/>
      </div>
      <div aria-hidden className="mt-1.5 grid grid-cols-3 text-[11.5px] text-neutral-500">
        <span>← spadek</span><span className="text-center">bez zmiany</span><span className="text-right">wzrost →</span>
      </div>
    </div>
    <p className="num mt-4 text-[13px] text-neutral-700">
      NDMI {index2(base)} → ok. <strong className="font-semibold text-neutral-950">{after(mid)}</strong>
      <span className="text-neutral-500"> (przedział 80%: {after(lo)}–{after(hi)})</span></p>
    {forecast.text?.length > 1 && <ul className="mt-3 flex list-disc flex-col gap-1 pl-4 text-[12.5px] leading-relaxed text-neutral-500 marker:text-neutral-300">
      {/* text[0] to zdanie z liczbami, pokazane wyżej jako oś; dalej uwagi o pewności */}
      {forecast.text.slice(1).map((line, i) => <li key={i}>{line}</li>)}
    </ul>}
  </Card>;
}

// ---------- podsumowanie ----------

/**
 * Zakładka „Podsumowanie”: ocena, zapas wody z liczbami, przyczyny, zieloność roślin i (na końcu) nawadnianie.
 * Przy drukowaniu blok nawadniania trafia na koniec zakładki Rekomendacje, po retencji i agrotechnice.
 * `intro`: wejście (ocena, karty liczb) tylko przy pierwszym pokazaniu raportu, nie przy powrocie na zakładkę.
 */
export function Summary({ report, terrain, satellite, sat, limited, onTab, printing, intro = false }) {
  return <div className="flex flex-col gap-14">
    {/* bez modelu 3D i mapy: te są w zakładkach Gleba i Teren i woda, tu same informacje */}
    <Verdict report={report} terrain={terrain} limited={limited} onTab={onTab} intro={intro}/>
    <WaterReserve report={report} intro={intro}/>
    <div className="grid gap-14 md:grid-cols-12 md:gap-12">
      <div className="min-w-0 md:col-span-7"><Causes report={report} terrain={terrain} onTab={onTab}/></div>
      <div className="min-w-0 md:col-span-5"><Greenness satellite={satellite} failed={sat.failed} retry={sat.retry}
        canRetry={sat.canRetry} printing={printing}/></div>
    </div>
    {!printing && <Irrigation report={report} terrainActions={terrain?.recommendations ?? []} intro={intro}/>}
  </div>;
}
