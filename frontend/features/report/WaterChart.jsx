import { useCallback, useId, useLayoutEffect, useRef, useState } from 'react';
import { dateText } from '@/shared/format/date';
import { number } from '@/shared/format/number';
import { ChartEmpty, useHoverIndexKeys } from '@/shared/ui/effects';

const MONTHS = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'];
const PAD = { top: 16, right: 16, bottom: 30, left: 40 };   // dół: tylko na podpisy miesięcy
const MIN_WIDTH = 240;                 // węższego nie rysujemy; szerszy niż kolumna telefonu dawałby poziome przewijanie
const TIP = { width: 224, gap: 12 };   // dymek: szerokość (w-56, mieści „opad 13,5 mm · próg stresu 45%” w jednej linii) i odstęp od kursora
const NAV_KEYS = ['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Escape'];
const FORECAST_LABEL_WIDTH = 66;       // szerokość napisu „prognoza →” (mono 10,5 px)
const FORECAST_SHARE = 0.22;           // część szerokości dla dni prognozy: rok historii jest gęsty, a prognoza czytelna
const RAIN_H = 26;                     // najwyższy słupek opadu w historii [px]
const FORECAST_RAIN_H = 48;            // w prognozie wyższy i podpisany w mm (własna skala, od 5 mm w górę)

const percent = (value) => (Number.isFinite(value) ? `${number(value)}%` : '—');
const mm = (value) => (Number.isFinite(value) ? `${number(value, 1)} mm` : '—');
const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));

/** Prognoza: dni bilansu na prognozie pogody i dni modelu ML (`ml.points`) złączone po dacie. */
function futurePoints(forecast, mlPoints) {
  const byDate = new Map(forecast.map((p) => [p.date, { ...p, kind: 'forecast' }]));
  for (const p of mlPoints) {
    byDate.set(p.date, { ...(byDate.get(p.date) ?? { date: p.date, kind: 'forecast' }),
      ml_pct: p.available_pct, ml_low: p.low_pct, ml_high: p.high_pct });
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Zapas wody w strefie korzeni (% TAW) na tle tych samych dni w 10 latach, z prognozą.
 * Od razu widać cały okres z backendu i pełną prognozę; dni prognozy mają szerszą oś (FORECAST_SHARE), żeby opad i linie były czytelne.
 * `ml`: prognoza modelu uczenia maszynowego (water_status.ml_forecast) – linia z pasem 80% obok bilansu na prognozie pogody.
 */
export function WaterChart({ series, forecast = [], ml = null, color, height = 300, intro = false }) {
  const box = useRef(null);
  const hintId = useId();
  const [width, setWidth] = useState(800);
  const [hover, setHover] = useState(null);
  const [fromKeys, setFromKeys] = useState(false);   // ostatni ruch z klawiatury: opis dnia trafia też do czytnika ekranu
  // szerokość mierzona przed pierwszym malowaniem, więc wykres nie mignie w złym rozmiarze
  useLayoutEffect(() => {
    const fit = (value) => setWidth(Math.max(MIN_WIDTH, value));
    fit(box.current.getBoundingClientRect().width);
    const observer = new ResizeObserver(([entry]) => fit(entry.contentRect.width));
    observer.observe(box.current);
    return () => observer.disconnect();
  }, []);

  const mlPoints = ml?.available ? ml.points ?? [] : [];
  const future = futurePoints(forecast, mlPoints);
  const past = series.map((p) => ({ ...p, kind: 'past' }));
  if (mlPoints.length && past.length) {   // linia modelu startuje z dzisiejszego zapasu
    const last = past[past.length - 1];
    past[past.length - 1] = { ...last, ml_pct: last.available_pct, ml_low: last.available_pct, ml_high: last.available_pct };
  }
  const points = [...past, ...future];
  const today = series.length - 1;
  const todayShown = today >= 0;

  // klawiatura jak w wykresach Spectrum (strzałki, Home/End, Escape); pierwszy krok liczony od dziś, nie od końca prognozy
  const setIndexFromToday = useCallback((next) => setHover((current) => (typeof next === 'function'
    ? next(current ?? clamp(today, 0, points.length - 1)) : next)), [today, points.length]);
  const keys = useHoverIndexKeys({ count: points.length, setIndex: setIndexFromToday });
  if (points.length < 2) return <div ref={box}>
    <ChartEmpty height={height} title="Za mało dni, żeby narysować przebieg zapasu." description=""/>
  </div>;

  const w = width - PAD.left - PAD.right, ht = height - PAD.top - PAD.bottom;
  const nFuture = points.length - 1 - today;   // dni prognozy po „dziś”
  const hasForecast = todayShown && nFuture > 0;
  // oś w dwóch odcinkach: historia do „dziś” na (1 − FORECAST_SHARE) szerokości, prognoza na resztę
  const split = hasForecast ? PAD.left + w * (1 - FORECAST_SHARE) : PAD.left + w;
  const pastStep = (split - PAD.left) / Math.max(hasForecast ? today : points.length - 1, 1);
  const futureStep = hasForecast ? (PAD.left + w - split) / nFuture : 0;
  const isPast = (i) => !hasForecast || i <= today;
  const x = (i) => (isPast(i) ? PAD.left + pastStep * i : split + futureStep * (i - today));
  const indexAt = (px) => (!hasForecast || px <= split
    ? Math.round((px - PAD.left) / pastStep) : today + Math.round((px - split) / futureStep));
  const y = (pct) => PAD.top + ht * (1 - clamp(pct, 0, 100) / 100);
  const line = (key, from = 0, to = points.length) => points.slice(from, to)
    .map((p, j) => (p[key] == null ? null : `${x(from + j).toFixed(1)},${y(p[key]).toFixed(1)}`)).filter(Boolean).join(' ');
  const area = (hi, lo) => {
    const span = points.map((p, i) => (p[hi] == null || p[lo] == null ? null : [i, p])).filter(Boolean);
    return span.length > 1
      ? `M${span.map(([i, p]) => `${x(i)},${y(p[hi])}`).join('L')}L${[...span].reverse().map(([i, p]) => `${x(i)},${y(p[lo])}`).join('L')}Z`
      : null;
  };
  const bandPath = area('typical_p90_pct', 'typical_p10_pct');
  const mlBandPath = area('ml_high', 'ml_low');
  // opad: w historii wspólna skala od 10 mm, w prognozie własna od 5 mm z podpisem, żeby kilka mm było widać
  const pastRainMax = Math.max(10, ...points.filter((_, i) => isPast(i)).map((p) => p.rain_mm ?? 0));
  const futureRainMax = Math.max(5, ...points.filter((_, i) => !isPast(i)).map((p) => p.rain_mm ?? 0));
  const rainBars = points.map((p, i) => {
    if (!(p.rain_mm > 0.5)) return null;
    const inPast = isPast(i);
    const barH = (inPast ? RAIN_H : FORECAST_RAIN_H) * p.rain_mm / (inPast ? pastRainMax : futureRainMax);
    const barW = inPast ? Math.max(2, pastStep / 1.25) : Math.max(4, futureStep * 0.6);
    return { i, p, inPast, x: x(i) - barW / 2, y: PAD.top + ht - barH, w: barW, h: barH };
  }).filter(Boolean);
  const months = points.map((p, i) => [i, p.date]).filter(([, d]) => d.slice(8) === '01');
  const forecastFrom = clamp(today, 0, points.length - 1);
  // napis przy linii „dziś” stoi nad prognozą; gdy pas prognozy jest za wąski (telefon), po lewej stronie linii, żeby nie wystawał
  const labelRight = hasForecast && x(today) + 8 + FORECAST_LABEL_WIDTH <= width;
  const active = hover == null ? null : points[hover];
  // dymek po prawej stronie kursora, przy prawej krawędzi po lewej; zawsze w granicach wykresu
  const tipLeft = active ? Math.max(0, Math.min(width - TIP.width,
    x(hover) + TIP.gap + TIP.width <= width ? x(hover) + TIP.gap : x(hover) - TIP.gap - TIP.width)) : 0;

  function move(event) {
    const i = indexAt(event.clientX - event.currentTarget.getBoundingClientRect().left);
    setFromKeys(false);
    setHover(i >= 0 && i < points.length ? i : null);
  }

  function onKeyDown(event) {
    if (!NAV_KEYS.includes(event.key) || event.altKey || event.ctrlKey || event.metaKey) return;   // Alt+← to „wstecz” przeglądarki
    if (event.key === 'Escape' && hover == null) return;   // nic do ukrycia: Escape zostaje dla okna wyżej (np. zamyka modal)
    setFromKeys(true);
    keys(event);
  }

  // fokus z klawiatury od razu pokazuje dzisiejszy dzień (widać, że wykres reaguje); kliknięcie myszą tego nie robi
  function onFocus(event) {
    if (!event.currentTarget.matches(':focus-visible')) return;
    setFromKeys(true);
    setHover((current) => current ?? clamp(today, 0, points.length - 1));
  }

  return <div ref={box} className={intro ? 'water-chart intro' : 'water-chart'}>
    <div className="relative select-none rounded-lg focus-visible:outline-offset-4" tabIndex={0} role="group" aria-label="Wykres zapasu wody"
      aria-describedby={hintId} onKeyDown={onKeyDown} onFocus={onFocus} onBlur={() => setHover(null)}>
      {/* viewBox: przy wydruku wykres skaluje się do szerokości strony zamiast obcinać prawą część */}
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img"
        onPointerMove={move} onPointerDown={move} onPointerLeave={() => setHover(null)}
        aria-label="Zapas wody w strefie korzeni na tle 10 lat, z prognozą">
        {[0, 25, 50, 75, 100].map((v) => <g key={v}>
          {/* włosowe linie siatki, ostre na każdym ekranie; linia 0% o ton mocniejsza: na niej stoją słupki opadu */}
          <line x1={PAD.left} x2={PAD.left + w} y1={y(v)} y2={y(v)} className="grid" shapeRendering="crispEdges"
            style={v ? undefined : { stroke: 'var(--color-neutral-300)' }}/>
          <text x={PAD.left - 8} y={y(v) + 4} textAnchor="end" className="axis">{v}%</text>
        </g>)}
        {/* miesiące tuż pod osią (należą do niej), nie w połowie drogi do legendy */}
        {months.map(([i, d]) => <text key={d} x={x(i)} y={PAD.top + ht + 17} textAnchor="middle" className="axis">{MONTHS[Number(d.slice(5, 7)) - 1]}</text>)}
        {hasForecast && <rect x={x(forecastFrom)} y={PAD.top} width={x(points.length - 1) - x(forecastFrom)} height={ht} className="forecast-zone"/>}
        {rainBars.map((b) => <rect key={b.p.date} x={b.x} width={b.w} y={b.y} height={b.h} rx={b.inPast ? 0 : 1.5} className={`rain ${b.p.kind}`}/>)}
        {/* podpis w pełnych mm (od 1 mm): dni prognozy stoją blisko siebie, a dokładna wartość jest w dymku */}
        {rainBars.filter((b) => !b.inPast && b.p.rain_mm >= 1).map((b) => <text key={`mm-${b.p.date}`} x={b.x + b.w / 2} y={b.y - 4}
          textAnchor="middle" className="rain-label">{number(b.p.rain_mm)}</text>)}
        {bandPath && <path d={bandPath} className="band"/>}
        <polyline points={line('typical_median_pct')} className="median"/>
        <polyline points={line('stress_threshold_pct')} className="threshold"/>
        {mlBandPath && <path d={mlBandPath} className="ml-band"/>}
        <polyline points={line('available_pct', 0, todayShown ? today + 1 : points.length)} pathLength={1} className="actual past" style={{ stroke: color }}/>
        {hasForecast && <polyline points={line('available_pct', forecastFrom)} className="actual forecast" style={{ stroke: color }}/>}
        {hasForecast && <polyline points={line('ml_pct', forecastFrom)} className="ml"/>}
        {todayShown && <line x1={x(today)} x2={x(today)} y1={PAD.top} y2={PAD.top + ht} className="today"/>}
        {/* bez wartości nie ma kropki (y(null) wypadłby na 0%, a to byłaby zmyślona liczba) */}
        {todayShown && Number.isFinite(points[today]?.available_pct)
          && <circle cx={x(today)} cy={y(points[today].available_pct)} r={6} style={{ fill: color }} className="today-dot"/>}
        {/* biała obwódka pod napisem: czytelny także wtedy, gdy przechodzi przez niego linia zapasu */}
        {todayShown && <text x={x(today) + (labelRight ? 8 : -8)} y={PAD.top + 12} textAnchor={labelRight ? 'start' : 'end'} className="axis strong"
          style={{ paintOrder: 'stroke', stroke: 'white', strokeWidth: 3, strokeLinejoin: 'round' }}>
          {hasForecast ? 'prognoza →' : dateText(series[series.length - 1].date)}</text>}
        {active && <g className="no-print">
          {/* kursor przerywany, żeby nie mylił się z ciągłą linią „dziś” */}
          <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + ht} className="cursor" strokeDasharray="3 3"
            style={{ stroke: 'var(--color-neutral-400)' }}/>
          {Number.isFinite(active.available_pct)
            && <circle cx={x(hover)} cy={y(active.available_pct)} r={4.5} style={{ fill: color }} stroke="white" strokeWidth={2}/>}
          {active.kind === 'forecast' && Number.isFinite(active.ml_pct)
            && <circle cx={x(hover)} cy={y(active.ml_pct)} r={4.5} className="ml-dot" stroke="white" strokeWidth={2}/>}
        </g>}
      </svg>
      {/* przy przesuwaniu dymek tylko zmienia miejsce (bez animacji); krótko pojawia się tylko pierwszy raz */}
      {active && <div aria-hidden="true" style={{ left: tipLeft }}
        className="no-print pointer-events-none absolute top-2 z-10 w-56 rounded-xl border border-border bg-white p-3 shadow-overlay animate-[chart-fade_120ms_var(--ease-out)]">
        <DayReadout point={active} color={color}/>
      </div>}
    </div>
    <p id={hintId} className="sr-only">Strzałkami w lewo i w prawo przejdziesz po kolejnych dniach.</p>
    <div className="sr-only" aria-live="polite">{fromKeys && active && <DayReadout point={active} color={color}/>}</div>
    <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 px-4 text-[12px] leading-4 text-neutral-500 sm:pl-10 sm:pr-0">
      <Key label="zapas na tym polu"><line x1="1.25" x2="14.75" y1="5" y2="5" className="actual" style={{ stroke: color }}/></Key>
      {forecast.length > 0 && <Key label="bilans na prognozie pogody"><line x1="1.25" x2="14.75" y1="5" y2="5" className="actual forecast" style={{ stroke: color }}/></Key>}
      {mlPoints.length > 0 && <Key label="prognoza modelu AI (pas: 80%)"><rect width="16" height="10" rx="2" className="ml-band"/><line x1="1.25" x2="14.75" y1="5" y2="5" className="ml"/></Key>}
      <Key label="zwykle w tych dniach (10 lat, 10–90%)"><rect width="16" height="10" rx="2" className="band"/></Key>
      <Key label="mediana 10 lat"><line x1="2" x2="14" y1="5" y2="5" className="median"/></Key>
      <Key label="próg stresu uprawy"><line x1="1.5" x2="14.5" y1="5" y2="5" className="threshold"/></Key>
      <Key label="opad"><rect x="5.5" y="1" width="5" height="9" className="rain"/></Key>
    </ul>
  </div>;
}

/** Opis jednego dnia: w dymku nad wykresem i ten sam tekst dla czytnika ekranu. */
function DayReadout({ point, color }) {
  const strong = 'font-medium text-neutral-800';
  const forecastDay = point.kind === 'forecast';
  const hasMl = forecastDay && Number.isFinite(point.ml_pct);
  return <>
    <p className="eyebrow num">{dateText(point.date)}{forecastDay && <span className="text-water-700"> · prognoza</span>}</p>
    {hasMl && <p className="mt-2 flex items-baseline gap-1.5 leading-none tracking-tight">
      <span aria-hidden="true" className="h-[3px] w-3 shrink-0 self-center rounded-full bg-water-600"/>
      <span className="text-[13px] font-medium text-neutral-600">Model AI</span>{' '}
      <span className="num text-[18px] font-semibold text-neutral-950">{percent(point.ml_pct)}</span>
      <span className="num text-[12px] text-neutral-500">({number(point.ml_low)}–{number(point.ml_high)}%)</span>
    </p>}
    {Number.isFinite(point.available_pct) && <p className="mt-2 flex items-baseline gap-1.5 leading-none tracking-tight">
      <span aria-hidden="true" className="h-[3px] w-3 shrink-0 self-center rounded-full" style={{ background: color }}/>
      <span className="text-[13px] font-medium text-neutral-600">{forecastDay ? 'Bilans' : 'Zapas'}</span>{' '}
      <span className={`num font-semibold text-neutral-950 ${hasMl ? 'text-[15px]' : 'text-[18px]'}`}>{percent(point.available_pct)}</span>
    </p>}
    {/* frazy się nie łamią w środku: przy wąskim dymku zawija się tylko między nimi */}
    <div className="num mt-2.5 space-y-0.5 text-[12px] leading-snug text-neutral-500">
      {point.typical_median_pct != null && <p>
        <span className="whitespace-nowrap">typowo <span className={strong}>{number(point.typical_median_pct)}%</span></span>{' '}
        <span className="whitespace-nowrap">(zwykle {number(point.typical_p10_pct)}–{number(point.typical_p90_pct)}%)</span>
      </p>}
      {(point.rain_mm != null || point.stress_threshold_pct != null) && <p>
        <span className="whitespace-nowrap">opad <span className={strong}>{mm(point.rain_mm)}</span></span>{' · '}
        <span className="whitespace-nowrap">próg stresu <span className={strong}>{percent(point.stress_threshold_pct)}</span></span>
      </p>}
    </div>
  </>;
}

/** Klucz legendy rysowany tymi samymi klasami co wykres, więc zawsze wygląda jak znak na wykresie. */
function Key({ label, children }) {
  return <li className="inline-flex items-center gap-2">
    <svg width="16" height="10" viewBox="0 0 16 10" aria-hidden="true" className="shrink-0">{children}</svg>{label}
  </li>;
}
