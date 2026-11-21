import { CircleAlert, CircleCheck, CircleDashed, CircleHelp, Eye, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';

// Ton stanu → klasy. Kolory z @theme (app.css): ok, watch, moderate, severe, unknown (+ -ink, -soft).
export const TONE = {
  ok: { text: 'text-ok-ink', bg: 'bg-ok-soft', ring: 'ring-ok/25', dot: 'bg-ok', fill: 'var(--color-ok)', ink: 'var(--color-ok-ink)', soft: 'var(--color-ok-soft)' },
  watch: { text: 'text-watch-ink', bg: 'bg-watch-soft', ring: 'ring-watch/30', dot: 'bg-watch', fill: 'var(--color-watch)', ink: 'var(--color-watch-ink)', soft: 'var(--color-watch-soft)' },
  moderate: { text: 'text-moderate-ink', bg: 'bg-moderate-soft', ring: 'ring-moderate/25', dot: 'bg-moderate', fill: 'var(--color-moderate)', ink: 'var(--color-moderate-ink)', soft: 'var(--color-moderate-soft)' },
  severe: { text: 'text-severe-ink', bg: 'bg-severe-soft', ring: 'ring-severe/25', dot: 'bg-severe', fill: 'var(--color-severe)', ink: 'var(--color-severe-ink)', soft: 'var(--color-severe-soft)' },
  unknown: { text: 'text-unknown-ink', bg: 'bg-unknown-soft', ring: 'ring-unknown/30', dot: 'bg-unknown', fill: 'var(--color-unknown)', ink: 'var(--color-unknown-ink)', soft: 'var(--color-unknown-soft)' },
  info: { text: 'text-water-700', bg: 'bg-water-50', ring: 'ring-water-500/20', dot: 'bg-water-500', fill: 'var(--color-water-500)', ink: 'var(--color-water-700)', soft: 'var(--color-water-50)' },
};

const ICONS = { ok: CircleCheck, watch: Eye, moderate: TriangleAlert, severe: CircleAlert, unknown: CircleHelp, info: CircleDashed };

/**
 * Plakietka stanu (wzór: Status Badge ze Spectrum UI): pigułka z obwódką, ikoną i krótkim tekstem.
 * `dot`: kropka zamiast ikony (gęste listy). `spin`: ikona się obraca (stan „w trakcie”).
 */
export function StatusBadge({ tone = 'unknown', children, icon, dot = false, spin = false, size = 'md', className, title }) {
  const t = TONE[tone] ?? TONE.unknown;
  const Icon = icon ?? ICONS[tone] ?? CircleHelp;
  return <span title={title} className={cn('inline-flex select-none items-center gap-1.5 whitespace-nowrap rounded-full font-medium leading-none ring-1 ring-inset',
    size === 'sm' ? 'px-2 py-1 text-[11.5px]' : 'px-2.5 py-1.5 text-[12.5px]', t.text, t.bg, t.ring, className)}>
    {dot ? <span aria-hidden className={cn('size-1.5 rounded-full', t.dot)}/>
      : <Icon aria-hidden strokeWidth={2.25} className={cn('size-3.5 shrink-0', spin && 'animate-spin [animation-duration:2.4s] motion-reduce:animate-none')}/>}
    {children}
  </span>;
}

/** Kropka stanu (np. przy nazwie pola na liście). */
export function StatusDot({ tone = 'unknown', className }) {
  const t = TONE[tone] ?? TONE.unknown;
  return <span aria-hidden className={cn('relative inline-flex size-2 shrink-0 rounded-full', t.dot, className)}/>;
}
