import { CloudRain, Droplet, Layers, Mountain, Thermometer, Waves } from 'lucide-react';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { SectionHeader } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export const MONTHS = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'];
export const TAB_LABELS = { podsumowanie: 'Podsumowanie', rekomendacje: 'Rekomendacje', prace: 'Prace polowe', gleba: 'Gleba',
  pogoda: 'Pogoda', teren: 'Teren i woda', historia: 'Historia', zrodla: 'Źródła' };
// „Prace polowe” nie trafiają do PDF: to plan z bieżącej prognozy, a nie część raportu na datę analizy
// kolejność w PDF: ocena → przyczyny → rekomendacje → źródła (narzucona przez zadanie)
export const PRINT_ORDER = ['podsumowanie', 'historia', 'pogoda', 'gleba', 'teren', 'rekomendacje', 'zrodla'];

/** Sekcja raportu: nagłówek (tytuł, opis, element po prawej) i treść. */
export function Section({ title, lead, aside, children, className }) {
  return <section className={cn('avoid-break min-w-0', className)}>
    <SectionHeader title={title} lead={lead} aside={aside}/>
    {children}
  </section>;
}

export function causeIcon(key) {
  if (key.includes('soil')) return Layers;
  if (key.includes('rain') || key.includes('precip') || key.includes('carry')) return CloudRain;
  if (key.includes('et0') || key.includes('heat') || key.includes('temp') || key.includes('demand')) return Thermometer;
  if (key.includes('slope') || key.includes('flow') || key.includes('terrain') || key.includes('runoff')) return Mountain;
  if (key.includes('river')) return Waves;
  return Droplet;
}

/** Przyczyny jako tytuły z ikoną; pełny opis rozwija się po kliknięciu (Accordion ze Spectrum UI). */
export function CauseList({ causes, limit }) {
  const items = limit ? causes.slice(0, limit) : causes;
  return <Accordion type="multiple" variant="default">{items.map((cause) => {
    const Icon = causeIcon(cause.key);
    return <AccordionItem key={cause.key} value={cause.key}>
      <AccordionTrigger className="py-3.5">
        <span className="flex min-w-0 items-center gap-3">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-700"><Icon className="size-4" strokeWidth={2}/></span>
          <span className="text-[14.5px] font-semibold text-neutral-900">{cause.title}</span>
        </span>
      </AccordionTrigger>
      <AccordionContent className="pl-11 text-[13.5px]"><p className="max-w-[72ch]">{cause.text}</p></AccordionContent>
    </AccordionItem>;
  })}</Accordion>;
}
