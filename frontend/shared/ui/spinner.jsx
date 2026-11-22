import { cn } from '@/shared/lib/cn';

/** Cienki spinner (łuk). Kręci się szybciej niż domyślne 1 s: szybszy spinner sprawia wrażenie szybszego ładowania. */
export function Spinner({ className, label }) {
  return <svg viewBox="0 0 24 24" fill="none" className={cn('size-4 animate-spin [animation-duration:650ms] motion-reduce:[animation-duration:1.6s]', className)}
    role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity=".18" strokeWidth="2.5"/>
    <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
  </svg>;
}
