import { cn } from '@/shared/lib/cn';

/**
 * Liczba z etykietą (typografia Stat Cards ze Spectrum UI): etykieta 13 px, wartość duża z cyframi równej szerokości,
 * pod spodem krótka podpowiedź. `tone`: kolor wartości (CSS), np. var(--color-severe-ink).
 */
export function Stat({ label, value, hint, color, size = 'md', className }) {
  return <div className={cn('min-w-0', className)}>
    <p className="truncate text-[13px] text-neutral-500">{label}</p>
    <p className={cn('num mt-1 font-medium leading-none tracking-tight text-neutral-950',
      size === 'lg' ? 'text-[30px]' : size === 'sm' ? 'text-[18px]' : 'text-[24px]')} style={color ? { color } : undefined}>{value}</p>
    {hint && <p className="mt-1.5 text-[12.5px] leading-snug text-neutral-500">{hint}</p>}
  </div>;
}

/** Siatka liczb rozdzielona włosowymi liniami (jedna ramka zamiast wielu kart). */
export function StatGrid({ className, children }) {
  return <div className={cn('surface grid grid-cols-2 gap-px overflow-hidden bg-black/[0.06] md:grid-cols-4 [&>*]:bg-white [&>*]:p-4 md:[&>*]:p-5', className)}>
    {children}
  </div>;
}
