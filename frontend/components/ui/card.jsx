import { forwardRef } from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cn } from '@/lib/utils';

/** Biała powierzchnia z włosową ramką (jak karty Spectrum). `interactive`: link/przycisk z reakcją na najechanie i nacisk. */
export const Card = forwardRef(function Card({ className, asChild, interactive, ...props }, ref) {
  const Comp = asChild ? Slot : 'div';
  return <Comp ref={ref} className={cn('surface block',
    // bez outline-none: w Tailwind v4 zeruje styl obrysu i fokus klawiatury byłby niewidoczny (globalny :focus-visible w app.css)
    interactive && 'transition-[border-color,box-shadow,scale] duration-200 ease-out hover:border-black/[0.14] hover:shadow-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 active:scale-[0.99]',
    className)} {...props}/>;
});

/** Mikro-etykieta (mono, wersaliki) nad liczbą albo blokiem. */
export function Eyebrow({ as: Comp = 'p', className, ...props }) {
  return <Comp className={cn('eyebrow', className)} {...props}/>;
}

/** Nagłówek sekcji raportu: tytuł, opcjonalny opis i element po prawej (np. linki). */
export function SectionHeader({ title, lead, aside, as: Heading = 'h2', className }) {
  return <div className={cn('mb-5 flex flex-wrap items-end justify-between gap-x-4 gap-y-2', className)}>
    <div className="min-w-0">
      <Heading className="text-[22px] font-semibold leading-tight md:text-[24px]">{title}</Heading>
      {lead && <p className="mt-1 max-w-[68ch] text-[14px] text-neutral-500">{lead}</p>}
    </div>
    {aside}
  </div>;
}
