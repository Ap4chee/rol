// Spectrum UI (https://spectrumhq.in, github.com/arihantcodes/spectrum-ui), komponent „stat-cards”.
// Licencja Apache-2.0 (plik LICENSE w tym katalogu). Zmodyfikowano na potrzeby WaterOS:
// zostały tylko części używane przez stat-cards (bez generatorów danych demonstracyjnych, które liczyły się
// przy imporcie), krzywa ruchu jak w app.css, teksty stanów po polsku, spacje w liczbach nie znikają.
'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

export const UP = 'var(--spectrum-chart-up)';
export const DOWN = 'var(--spectrum-chart-down)';
export const SURFACE = 'var(--spectrum-chart-surface)';
/** Mocne ease-out, to samo co --ease-out w app.css. */
export const EASE = 'cubic-bezier(0.23, 1, 0.32, 1)';

export function monotonePath(points: { x: number; y: number }[]): string {
  const n = points.length;
  if (n === 0) return '';
  if (n === 1) return `M${points[0].x},${points[0].y}`;

  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i += 1) {
    dx[i] = points[i + 1].x - points[i].x;
    slope[i] = dx[i] === 0 ? 0 : (points[i + 1].y - points[i].y) / dx[i];
  }

  const tangent = new Array<number>(n);
  tangent[0] = slope[0];
  tangent[n - 1] = slope[n - 2];
  for (let i = 1; i < n - 1; i += 1) {
    if (slope[i - 1] * slope[i] <= 0) {
      tangent[i] = 0;
    } else {
      const w1 = 2 * dx[i] + dx[i - 1];
      const w2 = dx[i] + 2 * dx[i - 1];
      tangent[i] = (w1 + w2) / (w1 / slope[i - 1] + w2 / slope[i]);
    }
  }

  let d = `M${points[0].x},${points[0].y}`;
  for (let i = 0; i < n - 1; i += 1) {
    const c1x = points[i].x + dx[i] / 3;
    const c1y = points[i].y + (tangent[i] * dx[i]) / 3;
    const c2x = points[i + 1].x - dx[i] / 3;
    const c2y = points[i + 1].y - (tangent[i + 1] * dx[i]) / 3;
    d += `C${c1x.toFixed(2)},${c1y.toFixed(2)} ${c2x.toFixed(2)},${c2y.toFixed(2)} ${points[i + 1].x.toFixed(2)},${points[i + 1].y.toFixed(2)}`;
  }
  return d;
}

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

/** Preferencja ograniczonego ruchu, czytana od razu (bez mignięcia animacji przy pierwszym rysowaniu). */
export function usePrefersReducedMotion() {
  const [reduce, setReduce] = React.useState(
    () => typeof window !== 'undefined' && window.matchMedia(REDUCED_MOTION).matches,
  );
  React.useEffect(() => {
    const mq = window.matchMedia(REDUCED_MOTION);
    const sync = () => setReduce(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);
  return reduce;
}

export const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

export function useTween(target: number[], { duration = 520, enabled = true } = {}) {
  const [value, setValue] = React.useState(target);
  const currentRef = React.useRef(target);
  const fromRef = React.useRef(target);
  const toRef = React.useRef(target);
  const startRef = React.useRef(0);
  const rafRef = React.useRef(0);

  React.useEffect(() => {
    if (!enabled) return;
    const to = toRef.current;
    const changed = to.length !== target.length || target.some((v, i) => v !== to[i]);
    if (!changed) return;

    toRef.current = target;

    if (currentRef.current.length !== target.length) {
      currentRef.current = target;
      fromRef.current = target;
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => setValue(target));
      return;
    }

    fromRef.current = currentRef.current;
    startRef.current = performance.now();
    cancelAnimationFrame(rafRef.current);

    const tick = (now: number) => {
      const p = Math.min(1, (now - startRef.current) / duration);
      const e = easeOutCubic(p);
      const from = fromRef.current;
      const dest = toRef.current;
      const next = dest.map((v, i) => from[i] + (v - from[i]) * e);
      currentRef.current = next;
      setValue(next);
      if (p < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  });

  React.useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  if (!enabled || value.length !== target.length) return target;
  return value;
}

export function useTweenNumber(target: number, options?: { duration?: number; enabled?: boolean }) {
  const vec = React.useMemo(() => [target], [target]);
  return useTween(vec, options)[0];
}

export const KEYFRAMES = `
@keyframes spectrum-mc-draw {
  from { stroke-dashoffset: 1; }
  to   { stroke-dashoffset: 0; }
}
@keyframes spectrum-mc-fade {
  from { opacity: 0; }
  to   { opacity: 1; }
}
@keyframes spectrum-sk-pulse {
  from { opacity: 1; }
  to   { opacity: 0.4; }
}
@keyframes spectrum-mc-enter {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes spectrum-mc-grow {
  from { transform: scaleX(0.04); }
  to   { transform: scaleX(1); }
}
`;

export function Keyframes() {
  return <style>{KEYFRAMES}</style>;
}

const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];

function Digit({ char, animate, duration }: { char: string; animate: boolean; duration: number }) {
  const digit = char >= '0' && char <= '9' ? Number(char) : null;
  if (digit == null) {
    // zwykła spacja w inline-block by się zwinęła („3 z 10” → „3z10”), więc twarda spacja
    return (
      <span aria-hidden className="inline-block h-[1em] align-bottom leading-none">
        {char === ' ' ? ' ' : char}
      </span>
    );
  }
  return (
    <span
      aria-hidden
      className="relative inline-block h-[1em] w-[1ch] overflow-hidden align-bottom leading-none"
    >
      <span
        className="absolute inset-x-0 top-0 block"
        style={{
          transform: `translateY(-${digit}em)`,
          transition: animate ? `transform ${duration}ms ${EASE}` : undefined,
        }}
      >
        {DIGITS.map((d) => (
          <span key={d} className="block h-[1em] text-center leading-none">
            {d}
          </span>
        ))}
      </span>
    </span>
  );
}

/** Liczba z cyframi przewijanymi przy zmianie. `duration`: krótko przy przeciąganiu po wykresie (cyfry nadążają za palcem). */
export function RollingNumber({
  value,
  format,
  className,
  animate = true,
  duration = 620,
}: {
  value: number;
  format: (value: number) => string;
  className?: string;
  animate?: boolean;
  duration?: number;
}) {
  const text = format(value);
  return (
    <span className={cn('inline-flex items-end leading-none tabular-nums', className)}>
      <span className="sr-only">{text}</span>
      {text.split('').map((char, index) => (
        <Digit key={`${index}-${char >= '0' && char <= '9' ? 'digit' : char}`} char={char} animate={animate} duration={duration} />
      ))}
    </span>
  );
}

// Kolory serii w tonacji aplikacji (app.css): woda, marka, stany niedoboru, szarość.
export const seriesVarsClassName =
  '[--spectrum-series-1:#1f80bf] [--spectrum-series-2:#3e8a59] [--spectrum-series-3:#d19a0b] [--spectrum-series-4:#e2701f] [--spectrum-series-5:#d33d31] [--spectrum-series-6:#72756c] [--spectrum-track:#ecece8] [--spectrum-chart-surface:#fff] [--spectrum-chart-up:#2f8a50] [--spectrum-chart-down:#d33d31]';

export const SERIES_COLORS = [
  'var(--spectrum-series-1)',
  'var(--spectrum-series-2)',
  'var(--spectrum-series-3)',
  'var(--spectrum-series-4)',
  'var(--spectrum-series-5)',
  'var(--spectrum-series-6)',
] as const;

export const TRACK = 'var(--spectrum-track)';

export function formatCount(value: number, digits = 1) {
  if (Math.abs(value) < 1000) return String(Math.round(value));
  return new Intl.NumberFormat('pl-PL', {
    notation: 'compact',
    maximumFractionDigits: digits,
  }).format(value);
}

export type ChartStatus = 'ready' | 'loading' | 'empty' | 'error';

export type SkeletonVariant = 'bars' | 'line' | 'grid' | 'rows' | 'arc' | 'cards';

const SKELETON_BARS = [46, 72, 55, 83, 41, 68, 92, 57, 76, 49, 88, 63];
const SKELETON_ROWS = [92, 74, 86, 61, 79, 55];

function SkeletonShapes({
  variant,
  height,
  mode,
  reduce,
}: {
  variant: SkeletonVariant;
  height: number;
  mode: 'pulse' | 'ghost';
  reduce: boolean;
}) {
  const animate = mode === 'pulse' && !reduce;
  const breathe = (index: number): React.CSSProperties | undefined =>
    animate
      ? { animation: `spectrum-sk-pulse 1.5s ease-in-out ${index * 120}ms infinite alternate` }
      : undefined;
  const block = 'rounded-md bg-black/[0.06]';

  if (variant === 'bars') {
    return (
      <div className="flex h-full items-end gap-2 pb-5 pt-3">
        {SKELETON_BARS.map((h, i) => (
          <div key={i} className={cn('flex-1', block)} style={{ height: `${h}%`, ...breathe(i) }} />
        ))}
      </div>
    );
  }

  if (variant === 'line') {
    return (
      <div className="relative flex h-full flex-col justify-between py-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-px w-full bg-black/[0.05]" />
        ))}
        <svg
          className="absolute inset-x-0 top-1/4 h-1/2 w-full"
          preserveAspectRatio="none"
          viewBox="0 0 100 40"
        >
          <path
            d="M0,30 C12,10 22,34 34,22 C46,10 54,28 66,16 C78,6 88,20 100,8"
            fill="none"
            className="stroke-black/[0.1]"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
            style={breathe(1)}
          />
        </svg>
      </div>
    );
  }

  if (variant === 'grid') {
    return (
      <div className="grid h-full grid-cols-12 grid-rows-6 gap-1.5 py-2">
        {Array.from({ length: 72 }, (_, i) => (
          <div key={i} className={cn('h-full w-full rounded-[3px]', block)} style={breathe(i % 14)} />
        ))}
      </div>
    );
  }

  if (variant === 'rows') {
    return (
      <div className="flex h-full flex-col justify-evenly py-2">
        {SKELETON_ROWS.map((w, i) => (
          <div key={i} className={cn('h-4', block)} style={{ width: `${w}%`, ...breathe(i) }} />
        ))}
      </div>
    );
  }

  if (variant === 'cards') {
    return (
      <div className="grid h-full grid-cols-2 content-center gap-3 py-2 sm:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="flex h-full min-h-16 flex-col justify-between gap-2 rounded-xl border border-black/[0.05] p-3"
            style={breathe(i)}
          >
            <div className={cn('h-2.5 w-1/2', block)} />
            <div className={cn('h-5 w-3/4', block)} />
            <div className={cn('h-6 w-full', block)} />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex h-full items-center justify-center">
      <div
        className="rounded-full border-[14px] border-black/[0.06]"
        style={{ width: height * 0.6, height: height * 0.6, ...breathe(0) }}
      />
    </div>
  );
}

export function ChartSkeleton({
  variant = 'bars',
  height = 300,
  className,
}: {
  variant?: SkeletonVariant;
  height?: number;
  className?: string;
}) {
  const reduce = usePrefersReducedMotion();
  return (
    <div className={cn('relative w-full overflow-hidden', className)} style={{ height }} aria-hidden>
      <Keyframes />
      <SkeletonShapes variant={variant} height={height} mode="pulse" reduce={reduce} />
    </div>
  );
}

function StateShell({
  height,
  variant,
  icon,
  iconClassName,
  title,
  description,
  action,
  role = 'status',
}: {
  height: number;
  variant: SkeletonVariant;
  icon: React.ReactNode;
  iconClassName?: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
  role?: 'status' | 'alert';
}) {
  const reduce = usePrefersReducedMotion();
  return (
    <div
      className="relative flex w-full items-center justify-center overflow-hidden rounded-xl border border-black/[0.06] bg-black/[0.015]"
      style={{ height }}
      role={role}
    >
      <Keyframes />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-5 inset-y-4 opacity-60"
        style={{
          maskImage: 'radial-gradient(ellipse 62% 58% at 50% 50%, transparent 34%, black 78%)',
          WebkitMaskImage: 'radial-gradient(ellipse 62% 58% at 50% 50%, transparent 34%, black 78%)',
        }}
      >
        <SkeletonShapes variant={variant} height={height} mode="ghost" reduce={reduce} />
      </div>
      <div
        className="relative flex max-w-[38ch] flex-col items-center gap-1 px-6 text-center"
        style={reduce ? undefined : { animation: `spectrum-mc-enter 420ms ${EASE} both` }}
      >
        <span
          className={cn(
            'mb-2 flex size-10 items-center justify-center rounded-xl border border-black/[0.07] bg-white text-neutral-500 shadow-xs',
            iconClassName,
          )}
        >
          {icon}
        </span>
        <p className="text-[13px] font-medium text-neutral-900">{title}</p>
        {description ? <p className="text-[12px] leading-relaxed text-neutral-500">{description}</p> : null}
        {action ? <div className="mt-3">{action}</div> : null}
      </div>
    </div>
  );
}

const actionClass =
  'press inline-flex items-center gap-1.5 rounded-full border border-black/10 bg-white px-3 py-1.5 text-[12px] font-medium text-neutral-900 shadow-xs hover:bg-black/[0.03] focus-visible:outline-2 focus-visible:outline-brand-600';

export function ChartEmpty({
  height = 300,
  variant = 'line',
  title = 'Brak danych',
  description = 'Gdy pojawią się dane, wykres wypełni się sam.',
  action,
}: {
  height?: number;
  variant?: SkeletonVariant;
  title?: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <StateShell
      height={height}
      variant={variant}
      title={title}
      description={description}
      action={action}
      icon={
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M4 19h16M7 16V9m5 7V5m5 11v-4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
      }
    />
  );
}

export function ChartError({
  height = 300,
  variant = 'line',
  title = 'Nie udało się wczytać danych',
  description = 'Serwer nie odpowiedział. Sprawdź połączenie i spróbuj ponownie.',
  onRetry,
  retryLabel = 'Ponów',
}: {
  height?: number;
  variant?: SkeletonVariant;
  title?: string;
  description?: string;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  return (
    <StateShell
      height={height}
      variant={variant}
      title={title}
      description={description}
      role="alert"
      iconClassName="text-severe"
      action={
        onRetry ? (
          <button type="button" onClick={onRetry} className={actionClass}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M20 11A8 8 0 1 0 18 16M20 5v6h-6"
                stroke="currentColor"
                strokeWidth="1.9"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            {retryLabel}
          </button>
        ) : null
      }
      icon={
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M12 8v5m0 3.5v.5M10.3 3.9 2.6 17.3A2 2 0 0 0 4.3 20h15.4a2 2 0 0 0 1.7-2.7L13.7 3.9a2 2 0 0 0-3.4 0Z"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      }
    />
  );
}

export function ChartState({
  status = 'ready',
  height = 300,
  variant = 'bars',
  empty,
  error,
  onRetry,
  children,
}: {
  status?: ChartStatus;
  height?: number;
  variant?: SkeletonVariant;
  empty?: { title?: string; description?: string; action?: React.ReactNode };
  error?: { title?: string; description?: string; retryLabel?: string };
  onRetry?: () => void;
  children: React.ReactNode;
}) {
  if (status === 'loading') {
    return (
      <div aria-busy="true" aria-live="polite">
        <ChartSkeleton variant={variant} height={height} />
        <span className="sr-only">Wczytuję dane wykresu</span>
      </div>
    );
  }
  if (status === 'empty') return <ChartEmpty height={height} variant={variant} {...empty} />;
  if (status === 'error') {
    return <ChartError height={height} variant={variant} onRetry={onRetry} {...error} />;
  }
  return <>{children}</>;
}

export function useHoverIndexKeys({
  count,
  setIndex,
  clear,
}: {
  count: number;
  setIndex: React.Dispatch<React.SetStateAction<number | null>>;
  clear?: () => void;
}) {
  return React.useCallback(
    (event: React.KeyboardEvent) => {
      const { key } = event;
      if (key === 'Escape') {
        event.preventDefault();
        if (clear) clear();
        else setIndex(null);
        return;
      }
      if (key === 'Home' || key === 'End') {
        event.preventDefault();
        setIndex(key === 'Home' ? 0 : count - 1);
        return;
      }
      if (key !== 'ArrowLeft' && key !== 'ArrowRight') return;
      event.preventDefault();
      const step = key === 'ArrowRight' ? 1 : -1;
      setIndex((current) => {
        const next = (current ?? count - 1) + step;
        return Math.max(0, Math.min(count - 1, next));
      });
    },
    [count, setIndex, clear],
  );
}
