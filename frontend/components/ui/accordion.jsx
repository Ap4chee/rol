import { AccordionContent as SpectrumContent } from '@/components/spectrumui/accordion';
import { usePrinting } from '@/lib/printing';

export { Accordion, AccordionItem, AccordionTrigger } from '@/components/spectrumui/accordion';

/** Treść sekcji rozwijanej (Accordion ze Spectrum UI). Przy drukowaniu zawsze w DOM i widoczna (app.css, @media print). */
export function AccordionContent(props) {
  const printing = usePrinting();
  return <SpectrumContent forceMount={printing || undefined} {...props}/>;
}
