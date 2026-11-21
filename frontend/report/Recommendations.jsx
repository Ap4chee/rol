import { ClipboardCheck, MapPin } from 'lucide-react';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Card } from '@/components/ui/card';
import { usePrinting } from '@/lib/printing';
import { cn } from '@/lib/utils';
import { Note } from '../ui.jsx';
import { number } from '../model.js';
import { MONTHS, Section } from './shared.jsx';

/** Grupy działań w kolejności narzuconej przez zadanie: najpierw retencja, potem agrotechnika, na końcu nawadnianie. */
export const GROUPS = [
  { key: 'retention', title: 'Zatrzymaj wodę na polu' },
  { key: 'agrotechnical', title: 'Zabiegi agrotechniczne' },
  { key: 'irrigation', title: 'Nawadnianie' },
];

/** Działania jednej grupy: z raportu, a za nimi z analizy terenu (doczytywanej osobno). */
export function groupActions(recommendations, terrainActions, category) {
  return [...(recommendations?.[category] ?? []), ...terrainActions.filter((item) => item.category === category)];
}

const IMAGES = {
  residue_cover: 'mulcz.jpg', cover_crop: 'miedzyplon.jpg', organic_matter: 'mulcz.jpg',
  buffer_strip_watercourse: 'zadrzewienia.jpg', reduced_tillage: 'mulcz.jpg',
  buffer_strip_flow_path: 'zadrzewienia.jpg', protect_depression: 'zaglebienie.jpg',
};
const CONFIDENCE = { wysoka: 3, 'średnia': 2, niska: 1 };
// wejście grup przy pierwszym pokazaniu zakładki: nierówne odstępy
const ENTER_MS = [0, 50, 90, 120];

function enter(intro, step) {
  return intro ? { className: 'animate-rise motion-reduce:animate-none', style: { animationDelay: `${ENTER_MS[step]}ms` } } : {};
}

/** Pewność jako trzy kropki obok słowa (szybciej czytelna na liście kart). */
function ConfidenceDots({ level }) {
  if (!level) return null;
  return <span aria-hidden className="inline-flex gap-[3px]">
    {[1, 2, 3].map((i) => <span key={i} className={cn('size-[5px] rounded-full', i <= level ? 'bg-neutral-700' : 'bg-neutral-200')}/>)}
  </span>;
}

function RecommendationCard({ item, printing }) {
  const image = IMAGES[item.key];
  return <Card className="overflow-hidden">
    {image && <img src={`/design/${image}`} alt="" loading={printing ? 'eager' : 'lazy'} decoding="async"
      className="h-28 w-full bg-neutral-100 object-cover"/>}
    <div className="p-5 pb-4">
      <h4 className="font-sans text-[15px] font-semibold leading-snug tracking-tight text-neutral-950">{item.title}</h4>
      <p className="mt-2 text-[14px] leading-relaxed text-neutral-700">{item.what}</p>
      {item.where && <p className="mt-3 flex gap-2 text-[13px] leading-snug text-neutral-500">
        <MapPin aria-hidden className="mt-px size-4 shrink-0 text-neutral-400" strokeWidth={2}/>{item.where}</p>}
    </div>
    <Accordion type="single" collapsible className="border-t border-black/[0.06]">
      <AccordionItem value="why">
        {/* pierścień fokusu do środka: karta przycina to, co wystaje (zaokrąglone rogi zdjęcia) */}
        <AccordionTrigger className="px-5 py-3 text-[13px] focus-visible:ring-inset">
          <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
            <span>Dlaczego na tym polu</span>
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <span aria-hidden className="text-neutral-400">·</span>pewność {item.confidence}
              <ConfidenceDots level={CONFIDENCE[item.confidence]}/>
            </span>
          </span>
        </AccordionTrigger>
        <AccordionContent className="px-5 pb-4 pr-5 text-[13.5px]">
          <p className="text-neutral-700">{item.why}</p>
          {item.confidence_reason && <p className="mt-2 text-[12.5px] leading-relaxed text-neutral-500">{item.confidence_reason}</p>}
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  </Card>;
}

/** Liczba z etykietą; etykiety mogą się zawinąć, liczby w rzędzie i tak stoją na jednej linii (dół komórki). */
function Figure({ label, value, hero }) {
  return <div className="flex min-w-0 flex-col justify-between">
    <p className="text-[12.5px] leading-snug text-neutral-500">{label}</p>
    <p className={cn('num mt-1.5 font-medium leading-none tracking-tight text-neutral-950', hero ? 'text-[26px]' : 'text-[20px]')}>
      {Number.isFinite(value) ? <>{number(value)}<span className="ml-1 text-[0.6em] font-normal tracking-normal text-neutral-500">mm</span></> : '—'}
    </p>
  </div>;
}

/** Ile wody trzeba by dodać w sezonie (netto) i jak rozkłada się to na miesiące w typowym roku. */
function IrrigationNeed({ need, crop, intro }) {
  if (!need) return null;
  if (need.status !== 'ok') return <Note section={need} className="mt-4"/>;
  const monthly = need.monthly ?? [];
  const max = Math.max(1, ...monthly.map((m) => m.mm));
  return <Card className="mt-5 p-5 md:p-6">
    <div className="grid gap-8 md:grid-cols-12 md:items-end md:gap-10">
      <div className="md:col-span-5">
        <h4 className="font-sans text-[15px] font-semibold leading-snug tracking-tight text-neutral-950">
          Ile wody potrzebuje {crop.name.toLowerCase()} w sezonie</h4>
        <div className="mt-4 grid grid-cols-3 gap-4">
          <Figure label="ten sezon do dziś" value={need.so_far_mm}/>
          <Figure label="typowy sezon" value={need.typical_mm} hero/>
          <Figure label="suchy rok" value={need.dry_mm}/>
        </div>
        <p className="mt-4 text-[12.5px] leading-relaxed text-neutral-500">
          Ilość netto, dawki po {number(need.dose_mm ?? 25)} mm, gdy zapas spada poniżej progu stresu.</p>
      </div>
      {monthly.some((m) => m.mm > 0) && <div className="min-w-0 md:col-span-7">
        <p className="text-[13px] text-neutral-500">Typowo w miesiącach (mm)</p>
        <div className="mt-3 grid h-40 auto-cols-fr grid-flow-col gap-1.5" role="img"
          aria-label={`Typowa potrzeba nawadniania w miesiącach: ${monthly.map((m) => `${MONTHS[m.month - 1]} ${number(m.mm)} mm`).join(', ')}`}>
          {monthly.map((m) => <div key={m.month} className="flex min-w-0 flex-col items-center gap-1.5">
            <div className="relative flex w-full flex-1 items-end justify-center pt-5">
              <div className="relative w-full max-w-9" style={{ height: `${Math.max(2, (100 * m.mm) / max)}%` }}>
                <div className={cn('absolute inset-0 rounded-t-[5px] bg-water-400', intro && 'bar-grow')}/>
                {m.mm >= 1 && <span className="num absolute inset-x-0 bottom-full mb-1 text-center text-[11px] font-medium leading-none text-neutral-700">
                  {number(m.mm)}</span>}
              </div>
            </div>
            <span className="text-[11px] leading-none text-neutral-500">{MONTHS[m.month - 1]}</span>
          </div>)}
        </div>
      </div>}
    </div>
  </Card>;
}

/**
 * Rekomendacje w stałej kolejności (retencja → agrotechnika → nawadnianie), z działaniami z analizy terenu
 * dopisanymi do swoich grup, i lista oględzin pola. `intro`: wejście grup przy pierwszym pokazaniu raportu.
 */
export function Recommendations({ report, terrainActions, intro = false }) {
  const printing = usePrinting();
  const data = report.recommendations;
  const checks = [...new Map([
    ...(data.field_checks ?? []), ...terrainActions.filter((item) => item.category === 'field_check'),
  ].map((item) => [item.key, item])).values()];
  const checksMotion = enter(intro, 3);

  return <Section title="Co robić?"
    lead="Działania w kolejności: najpierw zatrzymanie wody na polu, potem zabiegi agrotechniczne, na końcu nawadnianie.">
    <Note section={data}/>
    <ol className="mt-6">
      {GROUPS.map((group, i) => {
        const items = groupActions(data, terrainActions, group.key);
        const irrigation = group.key === 'irrigation';
        const last = i === GROUPS.length - 1;
        const empty = data.status !== 'ok' ? 'Na tym etapie brakuje danych do zaleceń.'
          : irrigation ? data.irrigation_note || 'Raport nie wskazuje potrzeby nawadniania.' : 'Raport nie wskazuje działań w tej grupie.';
        const motion = enter(intro, i);
        return <li key={group.key} className={cn('relative pl-11 md:pl-12', !last && 'pb-12', motion.className)} style={motion.style}>
          {!last && <span aria-hidden className="absolute bottom-0 left-[13.5px] top-10 w-px bg-black/[0.08]"/>}
          <span aria-hidden className={cn('num absolute left-0 top-0 grid size-7 place-items-center rounded-full border border-black/[0.1] bg-white text-[12.5px] font-semibold shadow-hairline',
            items.length ? 'text-neutral-800' : 'text-neutral-400')}>{i + 1}</span>
          <div className="flex min-h-7 flex-wrap items-center gap-x-2.5 gap-y-1">
            <h3 className="font-sans text-[16px] font-semibold tracking-tight text-neutral-950">{group.title}</h3>
            {items.length > 0 && <span className="num rounded-full bg-black/[0.05] px-2 py-0.5 text-[12px] font-medium leading-none text-neutral-600">{items.length}</span>}
          </div>
          <div className="mt-4">
            {items.length > 0
              ? <div className="grid items-start gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {/* klucz z pozycją: działanie z terenu może mieć ten sam klucz co działanie z raportu */}
                {items.map((item, n) => <RecommendationCard key={`${item.key}-${n}`} item={item} printing={printing}/>)}
              </div>
              : <p className="text-[14px] leading-relaxed text-neutral-500">{empty}</p>}
            {irrigation && items.length > 0 && data.irrigation_note
              && <p className="mt-3 text-[13.5px] leading-relaxed text-neutral-500">{data.irrigation_note}</p>}
            {irrigation && <IrrigationNeed need={report.irrigation_need} crop={report.crop} intro={intro}/>}
          </div>
        </li>;
      })}
    </ol>
    {checks.length > 0 && <div className={cn('mt-14', checksMotion.className)} style={checksMotion.style}>
      <h3 className="font-sans text-[16px] font-semibold tracking-tight text-neutral-950">Co sprawdzić na polu</h3>
      <ul className="surface mt-4 divide-y divide-black/[0.06]">
        {checks.map((item) => <li key={item.key} className="flex gap-3.5 p-4 md:px-5">
          <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-700">
            <ClipboardCheck className="size-4" strokeWidth={2}/></span>
          <div className="min-w-0 pt-0.5">
            <p className="text-[14px] font-semibold leading-snug text-neutral-900">{item.title}</p>
            <p className="mt-1 text-[13.5px] leading-relaxed text-neutral-500">{item.what}</p>
          </div>
        </li>)}
      </ul>
    </div>}
  </Section>;
}
