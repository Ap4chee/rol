import { AccordionContent as SpectrumContent } from '@/shared/vendor/spectrumui/accordion';
import { usePrinting } from '@/shared/lib/printing';

export { Accordion, AccordionItem, AccordionTrigger } from '@/shared/vendor/spectrumui/accordion';

/** Treść sekcji rozwijanej (Accordion ze Spectrum UI). Przy drukowaniu zawsze w DOM i widoczna (app.css, @media print). */
export function AccordionContent(props) {
  const printing = usePrinting();
  return <SpectrumContent forceMount={printing || undefined} {...props}/>;
}
