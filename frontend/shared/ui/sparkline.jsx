import { cn } from '@/shared/lib/cn';

/** Linia wartości w czasie (bez osi); kolor z `currentColor`. */
export function Sparkline({ values, min, max, label, height = 44, className }) {
  if (values.length < 2) return <p className="text-[13px] text-neutral-500">{values.length ? 'Jedna obserwacja' : 'Brak danych'}</p>;
  const span = max - min || 1;
  const points = values.map((value, i) => `${3 + 154 * i / (values.length - 1)},${39 - 34 * (value - min) / span}`).join(' ');
  return <svg className={cn('block w-full', className)} style={{ height }} viewBox="0 0 160 44" preserveAspectRatio="none" role="img" aria-label={label}>
    <path d="M3 39H157" fill="none" stroke="currentColor" strokeOpacity=".18" vectorEffect="non-scaling-stroke"/>
    <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke"/>
  </svg>;
}
