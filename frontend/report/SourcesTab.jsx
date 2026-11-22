import { CalendarDays } from 'lucide-react';
import { dateText, number } from '../model.js';
import { Paragraphs, statusTone } from '../ui.jsx';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { StatusBadge, StatusDot } from '@/components/ui/status';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { Section } from './shared.jsx';

// Stan źródła → opis i ton plakietki.
const SOURCE_STATE = {
  ok: ['Użyto', 'ok'], no_data: ['Brak danych', 'unknown'], error: ['Niedostępne', 'severe'], pending: ['W trakcie', 'info'],
};

/** Zakładka „Źródła”: skąd są dane i z jakiego okresu, czego nie wiemy, jak to policzono. */
export function SourcesTab({ report }) {
  const water = report.water_status;
  const limitations = report.limitations ?? [];
  // raport jest już scalony z dociągniętymi częściami (completion.js), więc wpisy źródeł są aktualne
  const sources = report.sources ?? [];
  const parcel = report.parcel;
  const place = parcel && [parcel.region && `obręb ${parcel.region}`, parcel.commune && `gm. ${parcel.commune}`,
    parcel.county && `pow. ${parcel.county}`, parcel.voivodeship && `woj. ${parcel.voivodeship}`].filter(Boolean).join(', ');
  return <div className="flex flex-col gap-14">
    <Section title="Skąd to wiemy">
      {/* pełny identyfikator EGiB tylko tutaj; w nagłówku raportu numer i obręb */}
      {parcel?.id && <p className="mb-4 text-[13.5px] text-neutral-600">
        Działka ewidencyjna <span className="num whitespace-nowrap font-mono text-[12.5px] text-neutral-900">{parcel.id}</span>
        {place && `, ${place}`}</p>}
      {/* w wąskim miejscu (telefon, wąska kolumna obok menu) okres danych schodzi pod nazwę źródła zamiast przewijania tabeli */}
      <div className="@container">
        <Table>
          <THead><TR>
            <TH>Źródło</TH><TH className="w-[136px]">Stan</TH><TH className="hidden w-[190px] @xl:table-cell">Dane z okresu</TH>
          </TR></THead>
          <TBody>{sources.map((source, i) => {
            const [label, tone] = SOURCE_STATE[source.status] ?? [source.status, 'unknown'];
            const note = source.status !== 'ok' ? [source.reason, source.impact].filter(Boolean).join(' ') : '';
            const period = source.data_date ?? (source.data_from ? `${dateText(source.data_from)} – ${dateText(source.data_to)}` : null);
            const periodText = period ?? <span className="text-neutral-400">brak daty</span>;
            return <TR key={source.key + i}>
              <TD className="py-3.5">
                <p className="font-medium text-neutral-900">{source.name}</p>
                {note && <p className="mt-1 max-w-[64ch] text-[12.5px] leading-snug text-neutral-500">{note}</p>}
                <p className="mt-1.5 flex items-start gap-1.5 text-[12.5px] text-neutral-600 @xl:hidden">
                  <CalendarDays aria-hidden className="mt-0.5 size-3.5 shrink-0 text-neutral-400"/>
                  <span><span className="sr-only">Dane z okresu: </span>{periodText}</span>
                </p>
              </TD>
              <TD className="py-3.5"><StatusBadge tone={tone} size="sm" spin={source.status === 'pending'}>{label}</StatusBadge></TD>
              <TD className="hidden py-3.5 text-[13px] @xl:table-cell">{periodText}</TD>
            </TR>;
          })}</TBody>
        </Table>
      </div>
    </Section>
    <Accordion type="multiple" className="border-y border-black/[0.07]">
      <AccordionItem value="limits">
        <AccordionTrigger className="font-semibold text-neutral-900">Czego nie wiemy ({limitations.length})</AccordionTrigger>
        <AccordionContent>
          {water.uncertainty_text && <p className="mb-4 max-w-[76ch] text-[13.5px] text-neutral-700">{water.uncertainty_text}</p>}
          <ul className="flex max-w-[76ch] list-disc flex-col gap-1.5 pl-5 text-[13.5px] text-neutral-700 marker:text-neutral-300">
            {limitations.map((line, i) => <li key={i}>{line}</li>)}
          </ul>
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="method">
        <AccordionTrigger className="font-semibold text-neutral-900">Jak to policzono</AccordionTrigger>
        <AccordionContent>
          <div className="max-w-[76ch] text-[13.5px] text-neutral-700"><Paragraphs lines={water.text}/></div>
          {water.variants?.length > 1 && <Table className="mt-5 max-w-[560px]">
            <THead><TR><TH>Wariant gleby</TH><TH className="text-right">Zapas</TH><TH>Ocena</TH></TR></THead>
            <TBody>{water.variants.map((variant) => <TR key={variant.key}>
              <TD>{variant.label}</TD>
              <TD className="text-right font-medium text-neutral-900">{number(100 * variant.available_mm / variant.taw_mm)}%</TD>
              <TD>
                <span className="flex items-start gap-2">
                  <StatusDot tone={statusTone({ status: 'ok', class_key: variant.class_key })} className="mt-1.5"/>{variant.class_label}
                </span>
              </TD>
            </TR>)}</TBody>
          </Table>}
          {report.soil?.status === 'ok' && report.soil.text?.length > 0 && <>
            <h4 className="mt-6 font-sans text-[14px] font-semibold tracking-tight text-neutral-900">Profil gleby</h4>
            <div className="mt-1.5 max-w-[76ch] text-[13.5px] text-neutral-700"><Paragraphs lines={report.soil.text}/></div>
          </>}
          {report.crop.assumptions?.length > 0 && <>
            <h4 className="mt-6 font-sans text-[14px] font-semibold tracking-tight text-neutral-900">Założenia o uprawie</h4>
            <div className="mt-1.5 max-w-[76ch] text-[13.5px] text-neutral-700"><Paragraphs lines={report.crop.assumptions}/></div>
          </>}
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  </div>;
}
