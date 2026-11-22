import { MapPin } from 'lucide-react';
import { number } from '@/shared/format/number';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/shared/ui/accordion';
import { StatCards } from '@/shared/ui/effects';
import { Note } from '@/shared/ui/note';
import { Section } from '@/shared/ui/section';
import { StatusBadge } from '@/shared/ui/status';
import { cn } from '@/shared/lib/cn';
import { TIMING } from '@/features/fields/logic';
import { actionArt, fieldChecks, GROUPS, groupActions, irrigationVerdict, needCards, pickFact } from './logic.js';

// wejście grup przy pierwszym pokazaniu zakładki: nierówne odstępy
const ENTER_MS = [0, 50, 90, 120];

function enter(intro, step) {
  return intro ? { className: 'animate-rise motion-reduce:animate-none', style: { animationDelay: `${ENTER_MS[step]}ms` } } : {};
}

/** Obrazek działania: zdjęcie zabiegu albo ilustracja grupy (te same co w „Najbliższych działaniach” na pulpicie). */
function ActionImage({ action, group }) {
  const { photo, src } = actionArt(action, group);
  // bez loading="lazy": przy druku zakładka jest daleko w dokumencie i obrazki mogłyby się nie wczytać
  return <span aria-hidden className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-lg bg-neutral-100 ring-1 ring-inset ring-black/[0.04]">
    <img src={src} alt="" width="44" height="44" decoding="async"
      className={photo ? 'size-full object-cover' : 'size-9 object-contain'}/>
  </span>;
}

/** Działanie jako wiersz: tytuł i jeden fakt z danych pola; jak to zrobić i pełne uzasadnienie po rozwinięciu. */
function RecommendationRow({ item, action, group, fact, rest }) {
  return <AccordionItem value={item.key}>
    {/* pierścień fokusu do środka: lista przycina to, co wystaje */}
    <AccordionTrigger className="items-start gap-3.5 px-4 py-4 font-sans focus-visible:ring-inset md:px-5">
      <span className="flex min-w-0 flex-1 gap-3.5">
        <ActionImage action={action} group={group}/>
        <span className="min-w-0 pt-0.5">
          <span className="block text-[15px] font-semibold leading-snug text-neutral-950">
            {item.title}
            {TIMING[item.timing] && <span className={cn('ml-2 inline-block translate-y-[-1px] whitespace-nowrap rounded-full px-2 py-0.5 align-middle text-[11.5px] font-medium',
              item.timing === 'now' ? 'bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-600/20' : 'bg-neutral-100 text-neutral-600')}>
              {TIMING[item.timing]}</span>}
          </span>
          {fact && <span className="mt-1 block text-[13.5px] font-normal leading-relaxed text-neutral-500">{fact}</span>}
        </span>
      </span>
    </AccordionTrigger>
    <AccordionContent className="space-y-3 pb-5 pl-[74px] pr-5 text-[13.5px] md:pl-[78px]">
      <div>
        <p className="font-semibold text-neutral-900">Jak to zrobić</p>
        <p className="mt-1 max-w-[68ch] text-neutral-700">{item.what}</p>
        {item.where && <p className="mt-2 flex gap-1.5 text-[13px] text-neutral-500">
          <MapPin aria-hidden className="mt-px size-4 shrink-0 text-neutral-400" strokeWidth={2}/>{item.where}</p>}
      </div>
      <div>
        <p className="font-semibold text-neutral-900">Skąd to wiemy</p>
        {rest.length > 0 && <p className="mt-1 max-w-[68ch] text-neutral-700">{rest.join(' ')}</p>}
        {item.confidence && <p className="mt-1 max-w-[68ch] text-[12.5px] leading-relaxed text-neutral-500">
          Pewność {item.confidence}.{item.confidence_reason ? ` ${item.confidence_reason}` : ''}</p>}
      </div>
    </AccordionContent>
  </AccordionItem>;
}

/**
 * Nawadnianie na pierwszym ekranie: plakietka „czy teraz” (z rekomendacji) z powodem i karty z potrzebą w sezonie (netto).
 */
export function Irrigation({ report, terrainActions, intro }) {
  const items = groupActions(report.recommendations, terrainActions, 'irrigation');
  const { label, tone, detail } = irrigationVerdict(report.recommendations, items, report.water_status);
  const need = report.irrigation_need;
  return <Section lead={detail} title={<span className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
    Nawadnianie<StatusBadge tone={tone}>{label}</StatusBadge></span>}>
    {need && (need.status === 'ok' ? <>
      <StatCards columns={2} intro={intro} cards={needCards(need)}/>
      <p className="mt-3 text-[12.5px] leading-relaxed text-neutral-500">
        Ilość netto, która ma trafić do gleby{need.dose_mm ? `: dawki po ${number(need.dose_mm)} mm` : ''}, gdy zapas spada poniżej
        progu stresu. Do wydajności instalacji trzeba doliczyć jej straty.</p>
    </> : <Note section={need}/>)}
  </Section>;
}

/**
 * Rekomendacje w stałej kolejności (retencja → agrotechnika → nawadnianie), z działaniami z analizy terenu
 * dopisanymi do swoich grup, i lista oględzin pola. Grupy bez działań to jeden wiersz, żeby nie udawały kroków.
 * `intro`: wejście grup przy pierwszym pokazaniu raportu.
 */
export function Recommendations({ report, terrainActions, printing = false, intro = false }) {
  const data = report.recommendations;
  const groups = GROUPS.map((group) => ({ ...group, items: groupActions(data, terrainActions, group.key) }));
  const shown = new Set();
  const checks = fieldChecks(data, terrainActions);
  const checksMotion = enter(intro, 3);

  return <Section title="Co robić?">
    <Note section={data}/>
    <div className="mt-6 max-w-6xl space-y-8">
      {groups.map(({ key, title, items }, i) => {
        const irrigation = key === 'irrigation';
        const note = irrigation ? data.irrigation_note : null;
        const motion = enter(intro, i);
        return <div key={key} className={motion.className} style={motion.style}>
          {items.length > 0 ? <>
            <h3 className="font-sans text-[16px] font-semibold tracking-tight text-neutral-950">{title}</h3>
            <Accordion type="multiple" className="surface mt-3 overflow-hidden">
              {/* klucz z pozycją: działanie z terenu może mieć ten sam klucz co działanie z raportu */}
              {items.map((item, n) => <RecommendationRow key={`${item.key}-${n}`} item={{ ...item, key: `${item.key}-${n}` }} action={item.key} group={key}
                {...pickFact(item.why, shown)}/>)}
            </Accordion>
            {note && <p className="mt-3 text-[13.5px] leading-relaxed text-neutral-500">{note}</p>}
          </> : <p className="text-[14px] leading-relaxed text-neutral-500">
            <span className="font-semibold text-neutral-800">{title}.</span>{' '}
            {data.status !== 'ok' ? 'Brakuje danych do zaleceń.' : note || 'Bez zaleceń dla tego pola.'}</p>}
        </div>;
      })}
    </div>
    {printing && <div className="mt-14"><Irrigation report={report} terrainActions={terrainActions} intro={false}/></div>}
    {checks.length > 0 && <div className={cn('mt-14 max-w-6xl', checksMotion.className)} style={checksMotion.style}>
      <h3 className="font-sans text-[16px] font-semibold tracking-tight text-neutral-950">Co sprawdzić na polu</h3>
      <ul className="surface mt-4 divide-y divide-black/[0.06]">
        {checks.map((item) => <li key={item.key} className="flex gap-3.5 p-4 md:px-5">
          <ActionImage action={item.key} group="field_check"/>
          <div className="min-w-0 pt-0.5">
            <p className="text-[14px] font-semibold leading-snug text-neutral-900">{item.title}</p>
            <p className="mt-1 text-[13.5px] leading-relaxed text-neutral-500">{item.what}</p>
          </div>
        </li>)}
      </ul>
    </div>}
  </Section>;
}
