import { ProgressWithValue } from '@/components/spectrumui/progress-with-value';
import { cn } from '@/lib/utils';

/**
 * Cienki pasek wartości 0–100 (Progress With Value ze Spectrum UI). `color`: kolor wypełnienia (CSS),
 * `marker`: pionowa kreska w miejscu wartości odniesienia (np. „zwykle”).
 */
export function Meter({ value, color, marker, label, size = 'md', className, track = 'bg-black/[0.06]' }) {
  const safe = Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0;
  return <div className={cn('relative', className)}>
    <ProgressWithValue value={safe} position="none" aria-label={label}
      className={cn(size === 'sm' ? 'h-1' : size === 'lg' ? 'h-2.5' : 'h-1.5', track)}
      indicatorStyle={color ? { background: color } : undefined}/>
    {Number.isFinite(marker) && <span aria-hidden className="absolute -top-1 -bottom-1 w-[2px] -translate-x-1/2 rounded-full bg-neutral-900"
      style={{ left: `${Math.min(100, Math.max(0, marker))}%` }}/>}
  </div>;
}
