import { useCallback, useId, useLayoutEffect, useRef, useState } from 'react';
import { ChartEmpty, useHoverIndexKeys } from '@/components/spectrumui/charts/chart-engine';
import { dateText, number } from './model.js';

const MONTHS = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'];
const PAD = { top: 16, right: 16, bottom: 30, left: 40 };   // dół: tylko na podpisy miesięcy
const MIN_WIDTH = 240;                 // węższego nie rysujemy; szerszy niż kolumna telefonu dawałby poziome przewijanie
const TIP = { width: 224, gap: 12 };   // dymek: szerokość (w-56, mieści „opad 13,5 mm · próg stresu 45%” w jednej linii) i odstęp od kursora
const NAV_KEYS = ['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Escape'];
const FORECAST_LABEL_WIDTH = 66;       // szerokość napisu „prognoza →” (mono 10,5 px)

const percent = (value) => (Number.isFinite(value) ? `${number(value)}%` : '—');
const mm = (value) => (Number.isFinite(value) ? `${number(value, 1)} mm` : '—');

/** Zapas wody w strefie korzeni (% TAW) w ostatnich miesiącach na tle tych samych dni w 10 latach, z prognozą. */
export function WaterChart({ series, forecast = [], color, height = 300, intro = false }) {
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
  const points = [...series.map((p) => ({ ...p, kind: 'past' })), ...forecast.map((p) => ({ ...p, kind: 'forecast' }))];
  const today = series.length - 1;
  // klawiatura jak w wykresach Spectrum (strzałki, Home/End, Escape); pierwszy krok liczony od dziś, nie od końca prognozy
  const setIndexFromToday = useCallback((next) => setHover((current) => (typeof next === 'function' ? next(current ?? today) : next)), [today]);
  const keys = useHoverIndexKeys({ count: points.length, setIndex: setIndexFromToday });
  if (points.length < 2) return <div ref={box}>
    <ChartEmpty height={height} title="Za mało dni, żeby narysować przebieg zapasu." description=""/>
  </div>;

  const w = width - PAD.left - PAD.right, h = height - PAD.top - PAD.bottom;
  const x = (i) => PAD.left + w * i / (points.length - 1);
  const y = (pct) => PAD.top + h * (1 - Math.min(100, Math.max(0, pct)) / 100);
  const line = (key, from = 0, to = points.length) => points.slice(from, to)
    .map((p, j) => (p[key] == null ? null : `${x(from + j).toFixed(1)},${y(p[key]).toFixed(1)}`)).filter(Boolean).join(' ');
  const band = series.map((p, i) => (p.typical_p90_pct == null ? null : [i, p])).filter(Boolean);
  const bandPath = band.length > 1
    ? `M${band.map(([i, p]) => `${x(i)},${y(p.typical_p90_pct)}`).join('L')}L${[...band].reverse().map(([i, p]) => `${x(i)},${y(p.typical_p10_pct)}`).join('L')}Z`
    : null;
  const maxRain = Math.max(10, ...points.map((p) => p.rain_mm ?? 0));
  const rainH = 26;
  const months = points.map((p, i) => [i, p.date]).filter(([, d]) => d.slice(8) === '01');
  // napis przy linii „dziś” stoi nad prognozą; gdy pas prognozy jest za wąski (telefon), po lewej stronie linii, żeby nie wystawał
  const labelRight = forecast.length > 0 && x(today) + 8 + FORECAST_LABEL_WIDTH <= width;
  const active = hover == null ? null : points[hover];
  // dymek po prawej stronie kursora, przy prawej krawędzi po lewej; zawsze w granicach wykresu
  const tipLeft = active ? Math.max(0, Math.min(width - TIP.width,
    x(hover) + TIP.gap + TIP.width <= width ? x(hover) + TIP.gap : x(hover) - TIP.gap - TIP.width)) : 0;

  function move(event) {
    const rect = event.currentTarget.getBoundingClientRect();
    const i = Math.round((event.clientX - rect.left - PAD.left) / w * (points.length - 1));
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
    setHover((current) => current ?? today);
  }

  return <div ref={box} className={intro ? 'water-chart intro' : 'water-chart'}>
    <div className="relative select-none rounded-lg focus-visible:outline-offset-4" tabIndex={0} role="group" aria-label="Wykres zapasu wody"
      aria-describedby={hintId} onKeyDown={onKeyDown} onFocus={onFocus} onBlur={() => setHover(null)}>
      {/* viewBox: przy wydruku wykres skaluje się do szerokości strony zamiast obcinać prawą część */}
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} onPointerMove={move} onPointerDown={move} onPointerLeave={() => setHover(null)} role="img"
        aria-label="Zapas wody w strefie korzeni w ostatnich miesiącach na tle 10 lat">
        {[0, 25, 50, 75, 100].map((v) => <g key={v}>
          {/* włosowe linie siatki, ostre na każdym ekranie; linia 0% o ton mocniejsza: na niej stoją słupki opadu */}
          <line x1={PAD.left} x2={PAD.left + w} y1={y(v)} y2={y(v)} className="grid" shapeRendering="crispEdges"
            style={v ? undefined : { stroke: 'var(--color-neutral-300)' }}/>
          <text x={PAD.left - 8} y={y(v) + 4} textAnchor="end" className="axis">{v}%</text>
        </g>)}
        {/* miesiące tuż pod osią (należą do niej), nie w połowie drogi do legendy */}
        {months.map(([i, d]) => <text key={d} x={x(i)} y={PAD.top + h + 17} textAnchor="middle" className="axis">{MONTHS[Number(d.slice(5, 7)) - 1]}</text>)}
        {points.map((p, i) => p.rain_mm > 0.5 && <rect key={p.date} x={x(i) - Math.max(1, w / points.length / 2.5)} width={Math.max(2, w / points.length / 1.25)}
          y={PAD.top + h - rainH * p.rain_mm / maxRain} height={rainH * p.rain_mm / maxRain} className={`rain ${p.kind}`}/>)}
        {bandPath && <path d={bandPath} className="band"/>}
        <polyline points={line('typical_median_pct', 0, series.length)} className="median"/>
        <polyline points={line('stress_threshold_pct')} className="threshold"/>
        {forecast.length > 0 && <rect x={x(today)} y={PAD.top} width={x(points.length - 1) - x(today)} height={h} className="forecast-zone"/>}
        <polyline points={line('available_pct', 0, series.length)} pathLength={1} className="actual past" style={{ stroke: color }}/>
        {forecast.length > 0 && <polyline points={line('available_pct', today, points.length)} className="actual forecast" style={{ stroke: color }}/>}
        <line x1={x(today)} x2={x(today)} y1={PAD.top} y2={PAD.top + h} className="today"/>
        {/* bez wartości nie ma kropki (y(null) wypadłby na 0%, a to byłaby zmyślona liczba) */}
        {Number.isFinite(series[today]?.available_pct)
          && <circle cx={x(today)} cy={y(series[today].available_pct)} r={6} style={{ fill: color }} className="today-dot"/>}
        {/* biała obwódka pod napisem: czytelny także wtedy, gdy przechodzi przez niego linia zapasu */}
        <text x={x(today) + (labelRight ? 8 : -8)} y={PAD.top + 12} textAnchor={labelRight ? 'start' : 'end'} className="axis strong"
          style={{ paintOrder: 'stroke', stroke: 'white', strokeWidth: 3, strokeLinejoin: 'round' }}>
          {forecast.length ? 'prognoza →' : dateText(series[today].date)}</text>
        {active && <g className="no-print">
          {/* kursor przerywany, żeby nie mylił się z ciągłą linią „dziś” */}
          <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + h} className="cursor" strokeDasharray="3 3"
            style={{ stroke: 'var(--color-neutral-400)' }}/>
          {Number.isFinite(active.available_pct)
            && <circle cx={x(hover)} cy={y(active.available_pct)} r={4.5} style={{ fill: color }} stroke="white" strokeWidth={2}/>}
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
    <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-[12px] leading-4 text-neutral-500 sm:pl-10">
      <Key label="zapas na tym polu"><line x1="1.25" x2="14.75" y1="5" y2="5" className="actual" style={{ stroke: color }}/></Key>
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
  return <>
    <p className="eyebrow num">{dateText(point.date)}{point.kind === 'forecast' && <span className="text-water-700"> · prognoza</span>}</p>
    <p className="mt-2 flex items-baseline gap-1.5 leading-none tracking-tight">
      <span aria-hidden="true" className="h-[3px] w-3 shrink-0 self-center rounded-full" style={{ background: color }}/>
      <span className="text-[13px] font-medium text-neutral-600">Zapas</span>{' '}
      <span className="num text-[18px] font-semibold text-neutral-950">{percent(point.available_pct)}</span>
    </p>
    {/* frazy się nie łamią w środku: przy wąskim dymku zawija się tylko między nimi */}
    <div className="num mt-2.5 space-y-0.5 text-[12px] leading-snug text-neutral-500">
      {point.typical_median_pct != null && <p>
        <span className="whitespace-nowrap">typowo <span className={strong}>{number(point.typical_median_pct)}%</span></span>{' '}
        <span className="whitespace-nowrap">(zwykle {number(point.typical_p10_pct)}–{number(point.typical_p90_pct)}%)</span>
      </p>}
      <p>
        <span className="whitespace-nowrap">opad <span className={strong}>{mm(point.rain_mm)}</span></span>{' · '}
        <span className="whitespace-nowrap">próg stresu <span className={strong}>{percent(point.stress_threshold_pct)}</span></span>
      </p>
    </div>
  </>;
}

/** Klucz legendy rysowany tymi samymi klasami co wykres, więc zawsze wygląda jak znak na wykresie. */
function Key({ label, children }) {
  return <li className="inline-flex items-center gap-2">
    <svg width="16" height="10" viewBox="0 0 16 10" aria-hidden="true" className="shrink-0">{children}</svg>{label}
  </li>;
}
