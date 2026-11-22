import { useId } from 'react';
import { Plus } from 'lucide-react';
import { ART_SHADOW } from '@/shared/assets';
import { Button } from '@/shared/ui/button';
import { Eyebrow } from '@/shared/ui/card';
import { cn } from '@/shared/lib/cn';
import { actionItems, byUrgency } from '@/features/fields/logic';
import { FieldCard, PendingFieldCard } from './FieldCard.jsx';
import { cardDelay, RISE, riseDelay, useIntroOnce } from './motion.js';
import { NextActions } from './NextActions.jsx';
import { Overview } from './Overview.jsx';

/** Pusty pulpit: ilustracja, jedno zdanie i przycisk; samo dodawanie pola jest w modalu. */
function EmptyState({ onAdd }) {
  return <div className={cn('mx-auto flex max-w-[460px] flex-col items-center px-2 py-16 text-center md:py-24', RISE)}>
    <img src="/design/pole.webp" alt="" width="360" height="220" decoding="async" className={cn('h-auto w-[300px] md:w-[360px]', ART_SHADOW)}/>
    <h1 className="mt-6 font-display text-[28px] font-semibold leading-[1.05] tracking-tight md:text-[34px]">Dodaj pierwsze pole</h1>
    <p className="mt-3 max-w-[42ch] text-[15px] leading-relaxed text-neutral-600">
      Wpisz numer działki albo wskaż ją na mapie. Sprawdzimy, czy brakuje jej wody i co z tym zrobić.</p>
    <Button size="lg" className="mt-8" icon={<Plus/>} onClick={onAdd} data-tour="add">Dodaj pole</Button>
  </div>;
}

/**
 * Pulpit: stan wody na wszystkich polach, karty pól od najpilniejszego, najbliższe działania i prognoza.
 * Kartę prognozy daje aplikacja (`renderWeather`), bo należy do funkcji pogody, a pulpit tylko wskazuje jej miejsce.
 */
export function Dashboard({ fields, onAdd, onEdit, onDelete, renderWeather }) {
  const fieldsTitleId = useId();
  const intro = useIntroOnce(fields.length > 0);
  if (!fields.length) return <EmptyState onAdd={onAdd}/>;
  // pola bez raportu (pierwsze liczenie trwa albo się nie udało) na górze, potem od najpilniejszego
  const ready = fields.filter((field) => field.report);
  const sorted = [...fields.filter((field) => !field.report), ...byUrgency(ready)];
  const actions = actionItems(ready);
  const date = new Intl.DateTimeFormat('pl-PL', { dateStyle: 'full', timeZone: 'Europe/Warsaw' }).format(new Date());
  // wejście (kaskada kart, pasek, liczniki) raz na sesję; po powrocie z raportu pulpit jest od razu na miejscu
  return <div className={cn('@container/dash flex flex-col gap-10', !intro && '[&_.animate-in]:!animate-none [&_.animate-rise]:!animate-none')}>
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <div className="min-w-0">
        <Eyebrow>{date}</Eyebrow>
        <h1 className="mt-2 font-display text-[28px] font-semibold leading-[1.05] tracking-tight md:text-[34px]">Pulpit</h1>
      </div>
      <Button icon={<Plus/>} onClick={onAdd} data-tour="add">Dodaj pole</Button>
    </header>
    {ready.length > 0 && <Overview fields={ready} intro={intro}/>}
    {/* kolumna boczna dopiero od 64rem szerokości pulpitu (prognoza potrzebuje ok. 290 px); węziej karty, a pod nimi panele */}
    <div className="grid gap-x-8 gap-y-10 @5xl/dash:grid-cols-12">
      <section aria-labelledby={fieldsTitleId} className="min-w-0 @5xl/dash:col-span-8">
        <h2 id={fieldsTitleId} className="mb-4 font-display text-[20px] font-semibold leading-[26px] tracking-tight">Pola od najpilniejszego</h2>
        <div className="grid gap-4 @xl/dash:grid-cols-2">
          {sorted.map((field, i) => {
            const Tile = field.report ? FieldCard : PendingFieldCard;
            return <Tile key={field.id} field={field} onEdit={onEdit} onDelete={onDelete} style={cardDelay(i)}/>;
          })}
        </div>
      </section>
      {/* obok kart: górna krawędź równo z pierwszym rzędem kart (wysokość nagłówka 26 px + odstęp 16 px) */}
      <aside aria-label="Działania i pogoda"
        className="grid min-w-0 content-start gap-4 @2xl/dash:grid-cols-2 @5xl/dash:col-span-4 @5xl/dash:grid-cols-1 @5xl/dash:pt-[42px]">
        <NextActions items={actions} style={riseDelay(140)}/>
        {ready.length > 0 && renderWeather?.({ fields: byUrgency(ready), className: RISE, style: riseDelay(190) })}
      </aside>
    </div>
  </div>;
}
