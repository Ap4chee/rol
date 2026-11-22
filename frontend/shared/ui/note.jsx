import { cn } from '@/shared/lib/cn';
import { Callout } from './callout.jsx';

/** Brak danych albo błąd sekcji powiedziany wprost (nic nie pokazuje, gdy sekcja ma dane). */
export function Note({ section, fallback = 'Brak danych dla tej analizy.', className }) {
  if (section?.status === 'ok') return null;
  return <Callout tone={section?.status === 'error' ? 'danger' : 'neutral'} className={cn('my-2', className)}>
    {section?.reason || fallback}</Callout>;
}

/** Akapity z listy zdań. */
export function Paragraphs({ lines, className }) {
  return lines?.map((line, i) => <p key={i} className={cn(i ? 'mt-1.5' : '', className)}>{line}</p>);
}
