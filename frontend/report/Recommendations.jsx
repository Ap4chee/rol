import { MapPin } from 'lucide-react';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { StatCards } from '@/components/spectrumui/charts/stat-cards';
import { StatusBadge } from '@/components/ui/status';
import { cn } from '@/lib/utils';
import { Note, statusTone } from '../ui.jsx';
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

// wejście grup przy pierwszym pokazaniu zakładki: nierówne odstępy
const ENTER_MS = [0, 50, 90, 120];

function enter(intro, step) {
  return intro ? { className: 'animate-rise motion-reduce:animate-none', style: { animationDelay: `${ENTER_MS[step]}ms` } } : {};
}

// zdjęcia zabiegów (static/design) tylko tam, gdzie zdjęcie jednoznacznie pokazuje działanie; reszta ma ilustrację grupy
const ACTION_PHOTOS = { residue_cover: 'mulcz', cover_crop: 'miedzyplon', organic_matter: 'gleba',
  buffer_strip_watercourse: 'zadrzewienia', buffer_strip_flow_path: 'zadrzewienia', protect_depression: 'zaglebienie' };
const GROUP_IMAGES = { retention: 'retencja', agrotechnical: 'agrotechnika', irrigation: 'nawadnianie', field_check: 'ogledziny' };

/** Adres obrazka działania i czy to zdjęcie (kadrowane), czy ilustracja grupy (cała, na tle). */
export function actionArt(action, group) {
  const photo = ACTION_PHOTOS[action];
  return { photo: Boolean(photo), src: photo ? `/design/${photo}.jpg` : `/design/akcja-${GROUP_IMAGES[group]}.png` };
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

// shortcut: zdanie kończy się na [.!?] przed wielką literą („ok. 56 dni” zostaje w środku); krótki powód z backendu byłby pewniejszy
const SENTENCE_END = /(?<=[.!?])\s+(?=[A-ZĄĆĘŁŃÓŚŹŻ])/;

/** Pierwsze zdanie uzasadnienia, którego nie pokazał już wyższy wiersz (kilka działań bywa skutkiem tego samego faktu). */
function pickFact(why, shown) {
  const sentences = (why ?? '').split(SENTENCE_END).filter(Boolean);
  const fact = sentences.find((sentence) => !shown.has(sentence)) ?? sentences[0];
  shown.add(fact);
  return { fact, rest: sentences.filter((sentence) => sentence !== fact) };
}

/** Działanie jako wiersz: tytuł i jeden fakt z danych pola; jak to zrobić i pełne uzasadnienie po rozwinięciu. */
function RecommendationRow({ item, action, group, fact, rest }) {
  return <AccordionItem value={item.key}>
    {/* pierścień fokusu do środka: lista przycina to, co wystaje */}
    <AccordionTrigger className="items-start gap-3.5 px-4 py-4 font-sans focus-visible:ring-inset md:px-5">
      <span className="flex min-w-0 flex-1 gap-3.5">
        <ActionImage action={action} group={group}/>
        <span className="min-w-0 pt-0.5">
          <span className="block text-[15px] font-semibold leading-snug text-neutral-950">{item.title}</span>
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

/** Czy nawadniać teraz: wskazane, gdy raport ma działanie z grupy nawadniania; inaczej powód z `irrigation_note`. */
function irrigationVerdict(recommendations, items, water) {
  if (recommendations?.status !== 'ok') return { label: 'Brak oceny', tone: 'unknown',
    detail: recommendations?.reason ?? 'Brakuje danych do zaleceń.' };
  if (!items.length) return { label: 'Teraz niepotrzebne', tone: 'ok', detail: recommendations.irrigation_note };
  const evidence = items[0].evidence ?? {};
  return { label: 'Teraz wskazane', tone: statusTone(water),
    detail: Number.isFinite(evidence.to_threshold_mm)
      ? `Do progu stresu brakuje ok. ${number(evidence.to_threshold_mm)} mm, do pełnego zapasu ${number(evidence.full_refill_mm)} mm `
        + '(1 mm = 10 m³ na hektar). Najpierw działania zatrzymujące wodę, nawadnianie jako uzupełnienie.'
      : items[0].title };
}

const WATER = 'var(--color-water-500)';
const dosesWord = (n) => n === 1 ? 'dawka'
  : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'dawki' : 'dawek';

/** Dwie karty jak w „Zapasie wody”: typowy sezon ze słupkami miesięcy i bieżący sezon (poza sezonem: ile sezonów wymagało wody). */
function needCards(need) {
  const typical = {
    label: 'Nawadnianie w typowym sezonie', value: need.typical_mm ?? null, unit: 'mm', format: (v) => number(v), delta: false,
    color: WATER, caption: need.dry_mm != null ? `w suchym roku ${number(need.dry_mm)} mm` : null,
    bars: need.monthly?.length ? need.monthly.map((m) => ({ label: MONTHS[m.month - 1], value: m.mm })) : undefined,
  };
  if (need.so_far_mm != null) return [typical, {
    label: 'Nawadnianie w tym sezonie', value: need.so_far_mm, unit: 'mm', format: (v) => number(v), delta: false, color: WATER,
    caption: `do dziś, ${need.so_far_events} ${dosesWord(need.so_far_events)}`,
    progress: need.typical_mm ? Math.min(1, need.so_far_mm / need.typical_mm) : undefined,
  }];
  const needed = need.seasons_compared - need.seasons_without;
  return [typical, {
    label: 'Sezony z potrzebą nawadniania', value: need.seasons_compared ? needed : null, unit: `z ${need.seasons_compared}`,
    format: (v) => number(v), delta: false, color: WATER, caption: 'ostatnie pełne sezony',
    progress: need.seasons_compared ? needed / need.seasons_compared : undefined,
  }];
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
  const checks = [...new Map([
    ...(data.field_checks ?? []), ...terrainActions.filter((item) => item.category === 'field_check'),
  ].map((item) => [item.key, item])).values()];
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
