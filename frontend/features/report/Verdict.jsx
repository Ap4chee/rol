import { ArrowRight, CircleAlert } from 'lucide-react';
import { dateText } from '@/shared/format/date';
import { mm, number } from '@/shared/format/number';
import { stateImage } from '@/shared/assets';
import { Button } from '@/shared/ui/button';
import { Meter } from '@/shared/ui/meter';
import { Note } from '@/shared/ui/note';
import { TONE } from '@/shared/ui/status';
import { cn } from '@/shared/lib/cn';
import { firstAction, statusTone, waterPercent } from '@/features/fields/logic';
import { statusFill } from '@/features/fields/Status';
import { actionArt, GROUPS, groupActions, splitHeadline } from './logic.js';

const ACTION_EYEBROW = { now: 'Najważniejsze teraz', after_harvest: 'Najbliższe działanie: po zbiorze', long_term: 'Na kolejne sezony' };

/** Ocena na pierwszym ekranie: stan wody z paskiem zapasu, a obok najważniejsze działanie. */
export function Verdict({ report, terrain, limited, onTab, intro }) {
  const water = report.water_status;
  const result = water.result;
  const stressDay = water.forecast_stress_day;
  const pct = waterPercent(result);
  const latest = water.series?.at(-1);
  // próg stresu dotyczy rosnącej uprawy; poza sezonem pokazujemy sam zapas
  const threshold = water.in_season !== false && Number.isFinite(latest?.stress_threshold_pct) ? latest.stress_threshold_pct : null;
  // zapas dla gleby lżejszej i cięższej (kwantyle SoilGrids), pokazany jako ramka na pasku
  const variantPcts = (water.variants ?? []).map(waterPercent).filter((value) => value != null);
  const range = variantPcts.length > 1 ? [Math.min(...variantPcts), Math.max(...variantPcts)] : null;
  const actions = GROUPS.flatMap((group) => groupActions(report.recommendations, terrain?.recommendations ?? [], group.key)
    .map((item) => ({ ...item, group: group.key })));
  const first = firstAction(actions.filter((item) => item.group !== 'irrigation'))
    ?? firstAction(actions);
  const art = first && actionArt(first.key, first.group);
  const [context, statement] = splitHeadline(water.headline ?? 'Brakuje danych do oceny');
  const tone = TONE[statusTone(water)];
  const image = stateImage(water.status === 'ok' ? water.class_key : 'unknown');

  // jedna karta: ocena z lewej (ilustracja stanu, tło w kolorze stanu), najważniejsze działanie z obrazkiem z prawej
  return <section className={cn('surface overflow-hidden md:grid', first && 'md:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]',
    intro && 'animate-rise [animation-delay:70ms] motion-reduce:animate-none')}>
    <div className="flex flex-col p-6 md:p-8" style={{ backgroundImage: `linear-gradient(135deg, ${tone.soft} 0%, transparent 60%)` }}>
      <div className="flex items-center gap-4">
        {/* ilustracje stanu z /design, te same co w „Stanie wody na polach” na pulpicie */}
        <img src={image} alt="" width="112" height="112" decoding="async"
          className="size-16 shrink-0 drop-shadow-[0_8px_10px_rgba(0,0,0,0.12)] md:size-[72px]"/>
        <div className="min-w-0">
          <h2 className="eyebrow">Sytuacja wodna</h2>
          {context && <p className="mt-1 text-[14px] text-neutral-600">{context}</p>}
        </div>
      </div>
      <p className={cn('mt-5 font-display font-semibold leading-[1.08] tracking-tight text-balance text-neutral-950',
        statement.length > 48 ? 'text-[clamp(22px,2.2vw,28px)]' : 'text-[clamp(26px,2.6vw,34px)]')}>{statement}</p>
      {result && <>
        <p className="mt-4 text-[16px] leading-relaxed text-neutral-700">
          {result.depletion_mm > 1
            ? <>Brakuje <strong className="num font-semibold text-neutral-950">{mm(result.depletion_mm)}</strong> wody do pełnego zapasu</>
            : 'Zapas wody jest pełny'}
          {pct == null && <span className="num text-neutral-500"> · {number(result.available_mm)} z {mm(result.taw_mm)}</span>}
        </p>
        {pct != null && <div className="mt-4 max-w-[480px]">
          <Meter value={pct} color={statusFill(water)} marker={threshold ?? undefined} range={range ?? undefined}
            label={`Zapas wody: ${number(result.available_mm)} z ${mm(result.taw_mm)}`}/>
          <div className="num mt-2.5 flex flex-wrap justify-between gap-x-4 gap-y-1 text-[12.5px] text-neutral-500">
            <span>{number(result.available_mm)} z {mm(result.taw_mm)}</span>
            {range && <span className="inline-flex items-center gap-1.5">
              <span aria-hidden className="h-3 w-4 rounded-[3px] border border-neutral-900/35 bg-neutral-900/[0.05]"/>
              inna gleba: {number(range[0])}–{number(range[1])}%</span>}
            {threshold != null && <span className="inline-flex items-center gap-1.5">
              <span aria-hidden className="h-3 w-[2px] rounded-full bg-neutral-900"/>próg stresu {number(threshold)}%</span>}
          </div>
        </div>}
        {stressDay && <p className="mt-4 flex items-center gap-1.5 text-[14px] font-semibold text-severe-ink">
          <CircleAlert aria-hidden className="size-4 shrink-0" strokeWidth={2.25}/>Stres wodny od {dateText(stressDay)}</p>}
      </>}
      <Note section={water} className="mt-4"/>
    </div>

    {first && <div className="flex flex-col border-t border-black/[0.06] bg-neutral-50/70 p-5 md:border-l md:border-t-0 md:p-6">
      {/* zdjęcie zabiegu kadrowane na całą szerokość; ilustracja grupy cała, na jasnym tle */}
      <div aria-hidden className={cn('grid aspect-[16/7] place-items-center overflow-hidden rounded-xl ring-1 ring-inset ring-black/[0.05]',
        !art.photo && 'bg-white')}>
        <img src={art.src} alt="" width={art.photo ? 472 : 96} height={art.photo ? 288 : 96} decoding="async"
          className={art.photo ? 'size-full object-cover' : 'size-24 object-contain drop-shadow-[0_8px_10px_rgba(0,0,0,0.12)]'}/>
      </div>
      <p className="eyebrow mt-5">{ACTION_EYEBROW[first.timing] ?? 'Pierwsze działanie'}</p>
      <p className="mt-1.5 text-[17px] font-semibold leading-snug tracking-tight text-neutral-950">{first.title}</p>
      {first.what && <p className="mt-1.5 line-clamp-3 text-[13.5px] leading-relaxed text-neutral-600">{first.what}</p>}
      <Button variant="link" size="inline" className="press no-print mt-auto self-start pt-4 text-[13.5px]" iconRight={<ArrowRight className="size-3.5"/>}
        onClick={() => onTab('rekomendacje')}>
        {actions.length > 1 ? `Wszystkie działania (${actions.length})` : 'Szczegóły działania'}
      </Button>
    </div>}
  </section>;
}
