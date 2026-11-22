// Spectrum UI (https://spectrumhq.in, github.com/arihantcodes/spectrum-ui), komponent „stat-cards”.
// Licencja Apache-2.0 (plik LICENSE w tym katalogu). Zmodyfikowano na potrzeby Asystenta wody:
// bez zmiany procentowej, gdy porównanie nic nie znaczy (`delta: false`), kolor karty, jednostka, linia odniesienia
// („zwykle”), odcinki zamiast wykresu (np. sezony), brak wartości jako „—”, wejście tylko przy pierwszym pokazaniu
// (`intro`), karta w stylu `surface`, teksty i opisy dostępności po polsku. Bez danych demonstracyjnych.
'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import {
  type ChartStatus,
  ChartState,
  DOWN,
  EASE,
  Keyframes,
  RollingNumber,
  TRACK,
  UP,
  formatCount,
  monotonePath,
  seriesVarsClassName,
  useHoverIndexKeys,
  usePrefersReducedMotion,
  useTweenNumber,
} from './chart-engine';

export type StatCardSegment = { active: boolean; label?: string };

export type StatCardData = {
  label: string;
  series?: number[];
  /** Liczba główna. `null` (bez serii): wartość nieznana, karta pokazuje „—” i „brak danych”. */
  value?: number | null;
  previous?: number;
  progress?: number;
  format?: (value: number) => string;
  goodWhen?: 'up' | 'down';
  deltaLabel?: string;
  caption?: React.ReactNode;
  /** false: bez zmiany procentowej (np. suma narastająca zaczyna się od zera); pod liczbą zostaje `caption`. */
  delta?: boolean;
  /** Kolor linii, wypełnienia, paska i odcinków (CSS). Domyślnie zielony/czerwony według kierunku zmiany. */
  color?: string;
  /** Jednostka za liczbą, mniejsza i jaśniejsza (np. „mm”, „z 10”). */
  unit?: string;
  /** Podpis punktu przy przeglądaniu wykresu (np. data). Domyślnie „dzień X z N”. */
  pointLabel?: (index: number) => string;
  /** Wartość odniesienia: przerywana linia na wykresie (np. mediana „zwykle”). Skala zawsze ją obejmuje. */
  reference?: number | null;
  /** Dół skali wykresu (np. 0 dla sum narastających). Domyślnie najmniejsza wartość serii. */
  min?: number;
  /** Linia bazowa (np. 0): ciągła linia na wykresie; nad nią kolor karty, pod nią `belowColor`. */
  baseline?: number;
  /** Kolor linii i wypełnienia poniżej `baseline`. */
  belowColor?: string;
  /** Odcinki zamiast wykresu, po jednym na element (np. sezon); zapalone w kolorze karty. */
  segments?: StatCardSegment[];
  /** Podpisy pod pierwszym i ostatnim odcinkiem. */
  segmentEnds?: [string, string];
  /** Małe słupki zamiast wykresu, z podpisem pod każdym (np. miesiące); wartości w jednostce karty. */
  bars?: { label: string; value: number }[];
};

// kaskada przy wejściu: nierówne odstępy, najwyżej kilka kroków
const STAGGER_MS = [0, 50, 90, 120, 150, 170];

function StatCard({
  card,
  index,
  reduce,
  intro,
}: {
  card: StatCardData;
  index: number;
  reduce: boolean;
  intro: boolean;
}) {
  const { label, series, goodWhen = 'up', deltaLabel = 'od początku', caption, progress, segments, bars, unit } = card;
  const format = card.format ?? ((v: number) => formatCount(v, 1));
  const [hover, setHover] = React.useState<number | null>(null);
  const sparkRef = React.useRef<HTMLDivElement | null>(null);
  const uid = React.useId().replace(/:/g, '');

  const n = series?.length ?? 0;
  const known = card.value != null || n > 0;
  const headline = card.value ?? series?.[n - 1] ?? 0;
  // Ostatni punkt serii to ta sama wielkość co liczba główna (np. suma z okna): pokazujemy wtedy liczbę główną,
  // żeby zaokrąglenia wartości dziennych nie dawały na końcu wykresu innej liczby niż nagłówek.
  const pointValue = (i: number) => (i === n - 1 && card.value != null ? card.value : (series as number[])[i]);
  const shown = hover != null && n > 0 ? pointValue(hover) : headline;
  const pointText = (i: number) => (card.pointLabel ? card.pointLabel(i) : `dzień ${i + 1} z ${n}`);

  const base = card.previous ?? series?.[0] ?? 0;
  const delta =
    known && card.delta !== false && (card.previous != null || n > 0)
      ? base
        ? ((headline - base) / base) * 100
        : 0
      : null;
  const rising = (delta ?? 0) >= 0;
  const good = goodWhen === 'up' ? rising : !rising;
  const color = card.color ?? (good ? UP : DOWN);
  const animate = intro && !reduce;
  const delay = STAGGER_MS[Math.min(index, STAGGER_MS.length - 1)];
  const hasSpark = known && !segments?.length && !bars?.length && progress == null && n >= 2;

  const displayValue = useTweenNumber(shown, {
    duration: 260,
    enabled: !reduce && hover == null,
  });

  const [box, setBox] = React.useState({ w: 0, h: 0 });
  // useLayoutEffect: wykres jest gotowy w tej samej klatce, także gdy raport składa się do wydruku
  React.useLayoutEffect(() => {
    const node = sparkRef.current;
    if (!node) return;
    const ro = new ResizeObserver(([entry]) =>
      setBox({ w: entry.contentRect.width, h: entry.contentRect.height }),
    );
    ro.observe(node);
    const rect = node.getBoundingClientRect();
    setBox({ w: rect.width, h: rect.height });
    return () => ro.disconnect();
  }, [hasSpark]);

  const spark = React.useMemo(() => {
    if (!hasSpark || !series || box.w <= 0 || box.h <= 0) return null;
    let lo = card.min ?? Infinity;
    let hi = -Infinity;
    for (const v of series) {
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    if (card.reference != null) {
      lo = Math.min(lo, card.reference);
      hi = Math.max(hi, card.reference);
    }
    if (card.baseline != null) {
      lo = Math.min(lo, card.baseline);
      hi = Math.max(hi, card.baseline);
    }
    const span = hi - lo || 1;
    const y = (v: number) => 7 + (1 - (v - lo) / span) * (box.h - 16);
    const points = series.map((v, i) => ({ x: 3 + (i / (n - 1)) * (box.w - 6), y: y(v) }));
    const line = monotonePath(points);
    const baseline = card.baseline != null ? y(card.baseline) : null;
    // z linią bazową wypełnienie sięga do niej (nad i pod), bez niej do dołu wykresu
    const floor = baseline ?? box.h;
    return {
      line,
      area: `${line}L${points[n - 1].x},${floor}L${points[0].x},${floor}Z`,
      points,
      reference: card.reference != null ? y(card.reference) : null,
      baseline,
    };
  }, [hasSpark, series, n, box, card.min, card.reference, card.baseline]);

  const onMove = (clientX: number) => {
    const node = sparkRef.current;
    if (!node || n < 2) return;
    const rect = node.getBoundingClientRect();
    const t = (clientX - rect.left) / Math.max(1, rect.width);
    setHover(Math.max(0, Math.min(n - 1, Math.round(t * (n - 1)))));
  };
  const onKeyDown = useHoverIndexKeys({ count: n, setIndex: setHover });

  const scrubDot = hover != null && spark ? spark.points[hover] : null;
  const endDot = spark ? spark.points[n - 1] : null;
  const below = card.belowColor ?? color;
  const tone = (v: number) => (card.baseline != null && v < card.baseline ? below : color);
  // miejsce linii bazowej jako ułamek wysokości: tu gradient twardo przechodzi z koloru karty w `below`
  const split = spark?.baseline != null && box.h > 0 ? Math.max(0, Math.min(1, spark.baseline / box.h)) : null;

  let visual: React.ReactNode = null;
  if (known && segments?.length) {
    visual = (
      <div
        aria-hidden
        className="flex w-[44%] max-w-52 shrink-0 flex-col justify-center gap-2"
        style={animate ? { animation: `spectrum-mc-fade 500ms ease-out ${delay + 150}ms both` } : undefined}
      >
        <div className="flex h-7 items-stretch gap-[3px]">
          {segments.map((segment, i) => (
            <span
              key={i}
              title={segment.label}
              className="min-w-0 flex-1 rounded-[3px]"
              style={{ background: segment.active ? color : TRACK }}
            />
          ))}
        </div>
        {card.segmentEnds ? (
          <div className="flex justify-between font-mono text-[10px] leading-none tabular-nums text-neutral-400">
            <span>{card.segmentEnds[0]}</span>
            <span>{card.segmentEnds[1]}</span>
          </div>
        ) : null}
      </div>
    );
  } else if (known && bars?.length) {
    const top = Math.max(1, ...bars.map((bar) => bar.value));
    const text = (bar: { label: string; value: number }) => `${bar.label} ${format(bar.value)}${unit ? ` ${unit}` : ''}`;
    visual = (
      <div
        role="img"
        aria-label={`${label}: ${bars.map(text).join(', ')}`}
        className="flex w-[44%] max-w-52 shrink-0 flex-col justify-end gap-1.5"
        style={animate ? { animation: `spectrum-mc-fade 500ms ease-out ${delay + 150}ms both` } : undefined}
      >
        <div className="flex h-12 items-end gap-[3px]">
          {bars.map((bar, i) => (
            <span
              key={i}
              title={text(bar)}
              className="min-w-0 flex-1 rounded-t-[3px]"
              style={{ height: `${Math.max(6, (100 * bar.value) / top)}%`, background: bar.value >= 1 ? color : TRACK }}
            />
          ))}
        </div>
        <div aria-hidden className="flex gap-[3px] font-mono text-[10px] leading-none text-neutral-400">
          {bars.map((bar, i) => (
            <span key={i} className="min-w-0 flex-1 overflow-hidden text-center">{bar.label}</span>
          ))}
        </div>
      </div>
    );
  } else if (known && progress != null) {
    visual = (
      <div className="flex w-[38%] max-w-44 shrink-0 items-center">
        <div aria-hidden className="relative h-1.5 w-full overflow-hidden rounded-full" style={{ background: TRACK }}>
          <span
            className="absolute inset-y-0 left-0 rounded-full"
            style={{
              width: `${Math.max(0, Math.min(1, progress)) * 100}%`,
              background: card.color ?? 'var(--spectrum-series-2)',
              transformOrigin: 'left center',
              animation: animate ? `spectrum-mc-grow 700ms ${EASE} ${delay + 150}ms both` : undefined,
            }}
          />
        </div>
      </div>
    );
  } else if (hasSpark) {
    const at = hover ?? n - 1;
    visual = (
      <div
        ref={sparkRef}
        role="slider"
        tabIndex={0}
        aria-label={`${label}: przebieg`}
        aria-valuemin={1}
        aria-valuemax={n}
        aria-valuenow={at + 1}
        aria-valuetext={`${pointText(at)}: ${format(pointValue(at))}${unit ? ` ${unit}` : ''}`}
        className="relative w-[44%] max-w-52 shrink-0 cursor-crosshair touch-pan-y select-none self-stretch rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
        style={{ minHeight: 58 }}
        onKeyDown={onKeyDown}
        onBlur={() => setHover(null)}
        onPointerMove={(e) => onMove(e.clientX)}
        onPointerDown={(e) => onMove(e.clientX)}
        onPointerLeave={() => setHover(null)}
      >
        {spark ? (
          <svg
            width={box.w}
            height={box.h}
            viewBox={`0 0 ${box.w} ${box.h}`}
            className="block h-full w-full overflow-visible"
            aria-hidden
          >
            <defs>
              {split != null ? (
                <>
                  <linearGradient id={`${uid}-fill`} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2={box.h}>
                    <stop offset={0} stopColor={color} stopOpacity={0.24} />
                    <stop offset={split} stopColor={color} stopOpacity={0.06} />
                    <stop offset={split} stopColor={below} stopOpacity={0.06} />
                    <stop offset={1} stopColor={below} stopOpacity={0.24} />
                  </linearGradient>
                  <linearGradient id={`${uid}-stroke`} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2={box.h}>
                    <stop offset={split} stopColor={color} />
                    <stop offset={split} stopColor={below} />
                  </linearGradient>
                </>
              ) : (
                <linearGradient id={`${uid}-fill`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.22} />
                  <stop offset="100%" stopColor={color} stopOpacity={0.02} />
                </linearGradient>
              )}
            </defs>
            {spark.baseline != null ? (
              <line x1={0} x2={box.w} y1={spark.baseline} y2={spark.baseline} stroke="var(--color-neutral-300)" strokeWidth={1} />
            ) : null}
            {spark.reference != null ? (
              <line
                x1={0}
                x2={box.w}
                y1={spark.reference}
                y2={spark.reference}
                stroke="var(--color-neutral-400)"
                strokeWidth={1}
                strokeDasharray="3 3"
              />
            ) : null}
            <path
              d={spark.area}
              fill={`url(#${uid}-fill)`}
              style={animate ? { animation: `spectrum-mc-fade 620ms ease-out ${delay + 180}ms both` } : undefined}
            />
            <path
              d={spark.line}
              fill="none"
              stroke={split != null ? `url(#${uid}-stroke)` : color}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              pathLength={1}
              style={
                animate
                  ? { strokeDasharray: 1, animation: `spectrum-mc-draw 700ms ${EASE} ${delay}ms both` }
                  : undefined
              }
            />
            {scrubDot ? (
              <>
                <line x1={scrubDot.x} x2={scrubDot.x} y1={0} y2={box.h} stroke="var(--color-neutral-300)" strokeWidth={1} />
                <circle cx={scrubDot.x} cy={scrubDot.y} r={4.5} fill="#fff" stroke={tone(pointValue(hover!))} strokeWidth={2} />
              </>
            ) : endDot ? (
              <circle
                cx={endDot.x}
                cy={endDot.y}
                r={3}
                fill={tone(pointValue(n - 1))}
                stroke="#fff"
                strokeWidth={1.5}
                style={animate ? { animation: `spectrum-mc-fade 240ms ease-out ${delay + 620}ms both` } : undefined}
              />
            ) : null}
          </svg>
        ) : null}
      </div>
    );
  }

  return (
    <div
      role="group"
      aria-labelledby={`${uid}-label`}
      className="surface flex items-stretch justify-between gap-5 p-5"
      style={animate ? { animation: `spectrum-mc-enter 420ms ${EASE} ${delay}ms both` } : undefined}
    >
      <div className="flex min-w-0 flex-col justify-between">
        <p id={`${uid}-label`} className="text-[13px] leading-snug text-neutral-500">
          {label}
        </p>
        <p className="mt-2 flex items-end gap-1.5 text-[28px] font-medium leading-none tracking-tight text-neutral-950 tabular-nums">
          {known ? (
            <RollingNumber
              value={hover != null ? shown : displayValue}
              format={format}
              animate={!reduce}
              duration={hover != null ? 160 : 620}
            />
          ) : (
            <span>—</span>
          )}
          {known && unit ? (
            <span className="pb-[2px] text-[15px] font-normal tracking-normal text-neutral-500">{unit}</span>
          ) : null}
        </p>
        <p className="mt-2 h-[17px] truncate text-[12.5px] leading-[17px]">
          {hover != null && n > 0 ? (
            <span className="tabular-nums text-neutral-500">{pointText(hover)}</span>
          ) : delta != null ? (
            <span className="font-medium" style={{ color }}>
              {rising ? '↑' : '↓'} {Math.abs(delta).toFixed(0)}% {deltaLabel}
            </span>
          ) : (
            <span className="text-neutral-500">{known ? caption ?? ' ' : 'brak danych'}</span>
          )}
        </p>
      </div>
      {visual}
    </div>
  );
}

const COLUMN_CLASS: Record<number, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-1 sm:grid-cols-2',
  // 3 w rzędzie dopiero, gdy każda karta ma ok. 460 px (węższe są zbyt gęste); mierzone szerokością sekcji, nie okna
  3: 'grid-cols-1 sm:grid-cols-2 @min-[88rem]:grid-cols-3',
  4: 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-4',
};

export interface StatCardsProps {
  className?: string;
  cards?: StatCardData[];
  columns?: 1 | 2 | 3 | 4;
  status?: ChartStatus;
  onRetry?: () => void;
  /** Wejście kart (kaskada, rysowanie linii). false: od razu w stanie końcowym, np. po powrocie na zakładkę. */
  intro?: boolean;
}

export function StatCards({
  className,
  cards = [],
  columns = 2,
  status = 'ready',
  onRetry,
  intro = true,
}: StatCardsProps) {
  const reduce = usePrefersReducedMotion();

  return (
    <div className={cn('@container w-full', seriesVarsClassName, className)}>
      <Keyframes />
      <ChartState
        status={status}
        height={168}
        variant="cards"
        empty={{
          title: 'Brak danych',
          description: 'Gdy pojawią się dane, liczby wypełnią się same.',
        }}
        onRetry={onRetry}
      >
        <div className={cn('grid gap-3', COLUMN_CLASS[columns] ?? COLUMN_CLASS[2])}>
          {cards.map((card, index) => (
            <StatCard key={card.label} card={card} index={index} reduce={reduce} intro={intro} />
          ))}
        </div>
      </ChartState>
    </div>
  );
}
