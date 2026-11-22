import { CircleAlert, CircleCheck, Info, MapPin } from 'lucide-react';
import { cn } from '@/shared/lib/cn';

const TONES = {
  neutral: ['border-black/[0.07] bg-neutral-50 text-neutral-700', 'text-neutral-400', Info],
  danger: ['border-severe/20 bg-severe-soft text-severe-ink', 'text-severe', CircleAlert],
  warning: ['border-watch/25 bg-watch-soft text-watch-ink', 'text-watch', CircleAlert],
  ok: ['border-ok/20 bg-ok-soft text-ok-ink', 'text-ok', CircleCheck],
  info: ['border-water-500/20 bg-water-50 text-water-800', 'text-water-500', MapPin],
};

/** Komunikat w treści (np. brak danych, błąd, potwierdzona działka). */
export function Callout({ tone = 'neutral', icon, title, children, className, role }) {
  const [box, iconColor, DefaultIcon] = TONES[tone] ?? TONES.neutral;
  const Icon = icon === null ? null : icon ?? DefaultIcon;
  return <div role={role} className={cn('flex gap-2.5 rounded-xl border px-3.5 py-3 text-[13.5px] leading-snug', box, className)}>
    {Icon && <Icon aria-hidden className={cn('mt-px size-4 shrink-0', iconColor)} strokeWidth={2}/>}
    <div className="min-w-0">
      {title && <p className="font-semibold">{title}</p>}
      {children && <div className={title ? 'mt-0.5' : undefined}>{children}</div>}
    </div>
  </div>;
}
