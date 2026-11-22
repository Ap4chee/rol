import { ProgressWithValue } from '@/components/spectrumui/progress-with-value';
import { cn } from '@/lib/utils';

/**
 * Cienki pasek wartości 0–100 (Progress With Value ze Spectrum UI). `color`: kolor wypełnienia (CSS),
 * `marker`: pionowa kreska w miejscu wartości odniesienia (np. „zwykle”).
 * `range`: [od, do] w procentach, ramka przedziału niepewności nad paskiem.
 */
export function Meter({ value, color, marker, range, label, size = 'md', className, track = 'bg-black/[0.06]' }) {
  const safe = Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0;
  const clamp = (v) => Math.min(100, Math.max(0, v));
  const band = range && range.every(Number.isFinite) && range[1] - range[0] >= 1 ? range.map(clamp) : null;
  return <div className={cn('relative', className)}>
    {/* brak wartości to brak danych (null), nie „0%” dla czytnika ekranu */}
    <ProgressWithValue value={Number.isFinite(value) ? safe : null} position="none" aria-label={label}
      className={cn(size === 'sm' ? 'h-1' : size === 'lg' ? 'h-2.5' : 'h-1.5', track)}
      indicatorStyle={color ? { background: color } : undefined}/>
    {band && <span aria-hidden className="absolute -top-[5px] -bottom-[5px] rounded-[4px] border border-neutral-900/35 bg-neutral-900/[0.05]"
      style={{ left: `${band[0]}%`, width: `${band[1] - band[0]}%` }}/>}
    {Number.isFinite(marker) && <span aria-hidden className="absolute -top-1 -bottom-1 w-[2px] -translate-x-1/2 rounded-full bg-neutral-900"
      style={{ left: `${Math.min(100, Math.max(0, marker))}%` }}/>}
  </div>;
}
