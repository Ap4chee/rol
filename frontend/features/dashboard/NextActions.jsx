import { useId } from 'react';
import { motion } from 'motion/react';
import { ArrowRight } from 'lucide-react';
import { fieldTabHref } from '@/app/router';
import { actionGroupImage } from '@/shared/assets';
import { StatusDot } from '@/shared/ui/status';
import { cn } from '@/shared/lib/cn';
import { statusTone } from '@/features/fields/logic';
import { RISE } from './motion.js';

// Wiersz lekko odjeżdża w prawo przy najechaniu (wzór: Nav List Card ze Spectrum UI), sprężyna z małym odbiciem.
const NUDGE = { type: 'spring', bounce: 0.25, duration: 0.3 };

/** Pierwsze działanie dla każdego pola, od najpilniejszego; link prowadzi do zakładki rekomendacji. */
export function NextActions({ items, style }) {
  const titleId = useId();
  return <section aria-labelledby={titleId} className={cn('surface p-5', RISE)} style={style}>
    <div className="flex items-baseline justify-between gap-3">
      <h2 id={titleId} className="font-sans text-[15px] font-semibold tracking-tight text-neutral-900">Najbliższe działania</h2>
      {items.length > 0 && <span className="num text-[12.5px] text-neutral-400">{items.length}</span>}
    </div>
    {items.length ? <ul className="-mx-2 mt-3 flex flex-col gap-0.5">{items.map(({ field, action }) => {
      const image = actionGroupImage(action.category);
      return <li key={field.id}>
        <motion.a href={fieldTabHref(field.id, 'rekomendacje')} whileHover={{ x: 2 }} whileTap={{ scale: 0.98 }} transition={NUDGE}
          className="group flex items-start gap-3 rounded-xl p-2 transition-[background-color] duration-150 hover:bg-neutral-100">
          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-neutral-100 text-neutral-600 ring-1 ring-inset ring-black/[0.03] transition-[background-color] duration-150 group-hover:bg-white">
            {image ? <img src={image} alt="" width="32" height="32" loading="lazy" decoding="async" className="size-8 object-contain"/>
              : <ArrowRight aria-hidden className="size-4" strokeWidth={1.75}/>}</span>
          <span className="min-w-0 flex-1 py-px">
            <span className="flex items-center gap-1.5 text-[12px] leading-4 text-neutral-500">
              <StatusDot tone={statusTone(field.report.water_status)}/><span className="truncate">{field.name}</span></span>
            <span className="mt-1 block text-[13.5px] font-medium leading-snug text-neutral-900">{action.title}</span>
          </span>
        </motion.a>
      </li>;
    })}</ul> : <p className="mt-2 text-[13px] text-neutral-500">Zapisane raporty nie zawierają propozycji działań.</p>}
  </section>;
}
