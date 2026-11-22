import { useId, useRef } from 'react';
import { Check, Sprout } from 'lucide-react';
import { cropImage } from '@/shared/assets';
import { Callout } from '@/shared/ui/callout';
import { SkeletonReveal } from '@/shared/ui/effects';
import { cn } from '@/shared/lib/cn';

const CROP_GRID = 'grid grid-cols-4 gap-2 md:grid-cols-7';
// Zastępcze kafelki na czas pobierania listy (tyle, ile upraw zwraca dziś API), żeby układ nie skakał.
const CROP_SKELETON = <div className={CROP_GRID}>
  {Array.from({ length: 7 }, (_, i) => <div key={i} className="h-[104px] rounded-xl bg-neutral-100 sm:h-[112px]"/>)}
</div>;

/**
 * Wybór uprawy kafelkami z ilustracją (na wzór listy Model Selector ze Spectrum UI).
 * radiogroup z ruchomym fokusem: Tab wchodzi na wybraną uprawę, strzałki przenoszą wybór, Home/End skaczą na skraj.
 */
export function CropPicker({ crops, error, value, onChange, disabled }) {
  const labelId = useId();
  const tiles = useRef([]);
  const focusable = Math.max(0, crops?.findIndex((item) => item.key === value) ?? 0);

  function onKeyDown(event, at) {
    const last = crops.length - 1;
    const next = { ArrowRight: at + 1, ArrowDown: at + 1, ArrowLeft: at - 1, ArrowUp: at - 1, Home: 0, End: last }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    const index = next > last ? 0 : next < 0 ? last : next;
    onChange(crops[index].key);
    tiles.current[index]?.focus();
  }

  return <div>
    <span id={labelId} className="sr-only">Uprawa</span>
    {error ? <Callout tone="danger">Nie udało się pobrać upraw. {error}</Callout>
      : <SkeletonReveal loading={!crops} skeleton={CROP_SKELETON} pulseCount="infinite" revealDuration={300}>
        {crops ? <div role="radiogroup" aria-labelledby={labelId} aria-required="true" className={CROP_GRID}>
          {crops.map((item, at) => {
            const active = item.key === value;
            const image = cropImage(item.key);
            return <button key={item.key} ref={(node) => { tiles.current[at] = node; }} type="button" role="radio"
              aria-checked={active} tabIndex={at === focusable ? 0 : -1} disabled={disabled}
              onClick={() => onChange(item.key)} onKeyDown={(event) => onKeyDown(event, at)}
              className={cn('relative flex flex-col items-center gap-1 rounded-xl border px-1.5 pb-2 pt-2.5 text-center',
                'transition-[border-color,background-color,box-shadow,scale] duration-150 ease-out active:scale-[0.97] motion-reduce:active:scale-100',
                'focus-visible:outline-offset-[3px] disabled:pointer-events-none disabled:opacity-50',
                active ? 'border-brand-600 bg-brand-50/70 ring-[3px] ring-brand-600/15'
                  : 'border-black/[0.08] bg-white shadow-hairline hover:border-black/[0.16] hover:bg-neutral-50')}>
              {image ? <img src={image} alt="" draggable={false} decoding="async" className="size-12 object-contain sm:size-14"/>
                : <span className="grid size-12 place-items-center sm:size-14"><Sprout aria-hidden className="size-7 text-brand-500" strokeWidth={1.75}/></span>}
              {/* flex-1: krótka nazwa stoi na środku tej samej wysokości co dwuwierszowa w sąsiednim kafelku */}
              <span className={cn('flex flex-1 items-center text-[12.5px] font-medium leading-tight', active ? 'text-brand-900' : 'text-neutral-700')}>
                {item.name}</span>
              <span aria-hidden className={cn('absolute right-1 top-1 grid size-[18px] place-items-center rounded-full bg-brand-700 text-white',
                'shadow-[0_1px_2px_rgb(13_35_23/0.3)] transition-[opacity,scale] duration-150 ease-out',
                active ? 'scale-100 opacity-100' : 'scale-95 opacity-0')}>
                <Check className="size-3" strokeWidth={3}/>
              </span>
            </button>;
          })}
        </div> : <>{CROP_SKELETON}<span className="sr-only">Ładowanie upraw…</span></>}
      </SkeletonReveal>}
  </div>;
}
