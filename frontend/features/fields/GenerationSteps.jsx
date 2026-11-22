import { Check, CloudRain, Droplets, Layers, ListChecks, MapPin, Minus, Satellite, Waves } from 'lucide-react';
import { Spinner } from '@/shared/ui/spinner';
import { cn } from '@/shared/lib/cn';

// Etapy liczenia raportu w kolejności, w jakiej powstaje (serwer: `progress` pola, app/report.py).
// Pogoda, gleba, wody i zdjęcia pobierają się równolegle, więc kilka etapów może trwać naraz.
const STAGES = [
  ['parcel', MapPin, 'Granica działki', 'ewidencja gruntów (GUGiK)'],
  ['weather', CloudRain, 'Pogoda z 10 lat i prognoza', 'opad, temperatura i parowanie dzień po dniu'],
  ['soil', Layers, 'Gleba', 'warstwy i pojemność wodna (SoilGrids)'],
  ['water', Waves, 'Rzeki i wody w okolicy', 'wodowskazy IMGW i najbliższy ciek'],
  ['balance', Droplets, 'Bilans wodny', 'zapas wody w strefie korzeni i porównanie z poprzednimi latami'],
  ['satellite', Satellite, 'Zdjęcia satelitarne', 'Sentinel-2: zieloność i uwilgotnienie roślin (to trwa najdłużej)'],
  ['recommendations', ListChecks, 'Zalecenia', 'retencja, agrotechnika, nawadnianie'],
];

/** Lista etapów z rzeczywistym stanem: zrobione, w trakcie, czeka, pominięte (np. zdjęcia dla samego punktu). */
export function GenerationSteps({ field }) {
  const progress = field.progress;
  const queued = field.job === 'queued';
  const done = STAGES.filter(([key]) => progress?.[key] === 'done' || progress?.[key] === 'skipped').length;
  return <section aria-label="Postęp liczenia raportu" className="surface max-w-[560px] p-5 md:p-6">
    <div className="flex items-baseline justify-between gap-3">
      <h2 className="font-sans text-[15px] font-semibold tracking-tight text-neutral-900">
        {queued ? 'Raport czeka w kolejce' : 'Liczę raport'}</h2>
      <span role="status" className="num text-[12.5px] text-neutral-500">{progress ? `${done} z ${STAGES.length}` : queued ? 'zaraz ruszy' : 'zwykle do minuty'}</span>
    </div>
    <div aria-hidden className="mt-3 h-1 overflow-hidden rounded-full bg-black/[0.06]">
      <div className="h-full origin-left rounded-full bg-brand-600 transition-transform duration-500 ease-out motion-reduce:transition-none"
        style={{ transform: `scaleX(${done / STAGES.length})` }}/>
    </div>
    <ol className="mt-4 flex flex-col">
      {STAGES.map(([key, Icon, label, hint]) => {
        const state = progress?.[key] ?? 'waiting';
        return <li key={key} className="flex items-start gap-3 py-2">
          <span className={cn('mt-0.5 grid size-7 shrink-0 place-items-center rounded-full transition-colors duration-200 ease-out',
            state === 'done' ? 'bg-brand-700 text-white' : state === 'running' ? 'bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-600/20'
              : 'bg-neutral-100 text-neutral-400')}>
            {state === 'done' ? <Check aria-hidden className="size-3.5 animate-in zoom-in-75 duration-150 motion-reduce:animate-none" strokeWidth={3}/>
              : state === 'running' ? <Spinner className="size-3.5"/>
                : state === 'skipped' ? <Minus aria-hidden className="size-3.5"/> : <Icon aria-hidden className="size-3.5" strokeWidth={2}/>}
          </span>
          <div className="min-w-0">
            <p className={cn('text-[14px] font-medium leading-snug', state === 'waiting' || state === 'skipped' ? 'text-neutral-500' : 'text-neutral-900')}>
              {label}
              <span className="sr-only">: {state === 'done' ? 'gotowe' : state === 'running' ? 'w trakcie' : state === 'skipped' ? 'pominięte' : 'czeka'}</span>
            </p>
            <p className="mt-0.5 text-[12.5px] leading-snug text-neutral-500">
              {state === 'skipped' ? 'pominięte: pole wskazane punktem, bez granicy działki' : hint}</p>
          </div>
        </li>;
      })}
    </ol>
  </section>;
}
