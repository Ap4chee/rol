import { cn } from '@/shared/lib/cn';
import { SectionHeader } from './card.jsx';

/** Sekcja raportu: nagłówek (tytuł, opis, element po prawej) i treść. */
export function Section({ title, lead, aside, children, className }) {
  return <section className={cn('avoid-break min-w-0', className)}>
    <SectionHeader title={title} lead={lead} aside={aside}/>
    {children}
  </section>;
}

/** Wnioski słowne policzone na serwerze (pole `text` sekcji) jako krótka lista pod liczbami. */
export function Explanation({ lines, className }) {
  if (!lines?.length) return null;
  return <ul className={cn('mt-5 flex max-w-[76ch] list-disc flex-col gap-1.5 pl-5 text-[13.5px] leading-relaxed text-neutral-700 marker:text-neutral-300',
    className)}>
    {lines.map((line, i) => <li key={i}>{line}</li>)}
  </ul>;
}
