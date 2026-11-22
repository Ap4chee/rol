import { useId } from 'react';
import { stateImage } from '@/shared/assets';
import { NumberTicker } from '@/shared/ui/effects';
import { Eyebrow } from '@/shared/ui/card';
import { StatusDot, TONE } from '@/shared/ui/status';
import { cn } from '@/shared/lib/cn';
import { bucketsLead, waterBuckets } from './logic.js';
import { RISE } from './motion.js';

/** Stan wszystkich pól: zdanie, pasek udziałów i liczba pól w każdym stanie (pola bez oceny osobno, tylko gdy są). */
export function Overview({ fields, intro }) {
  const titleId = useId();
  const buckets = waterBuckets(fields);
  return <section aria-labelledby={titleId} className={cn('surface relative isolate overflow-hidden px-6 py-7 md:p-8', RISE)}>
    {/* krajobraz wychodzi z prawego górnego rogu karty (przycięty jej krawędzią), lewym i dolnym brzegiem rozmywa się w tle;
        w wąskim pulpicie zasłaniałby zdanie, więc znika */}
    <img src="/design/pulpit-pas.webp" alt="" width="1000" height="236" decoding="async"
      className="pointer-events-none absolute -right-3 -top-3 -z-10 hidden w-[56%] max-w-[620px] [mask-composite:intersect] [mask-image:linear-gradient(to_right,transparent,#000_30%),linear-gradient(to_bottom,#000_62%,transparent)] @3xl/dash:block"/>
    <Eyebrow id={titleId}>Stan wody na polach</Eyebrow>
    <p className="mt-3 font-display text-[26px] font-semibold leading-[1.15] tracking-tight text-balance text-neutral-950 md:text-[30px] @3xl/dash:max-w-[46%]">
      {bucketsLead(buckets)}</p>
    {/* udziały stanów w kolejności pilności; pasek wsuwa się raz, przy wejściu */}
    <div aria-hidden className="mt-7 h-2 overflow-hidden rounded-full">
      <div className="flex h-full gap-[3px] animate-in slide-in-from-left-full duration-[600ms] ease-out delay-150 fill-mode-both motion-reduce:animate-none">
        {buckets.filter((bucket) => bucket.count).map((bucket) =>
          <span key={bucket.key} className={cn('h-full min-w-1', TONE[bucket.tone].dot)} style={{ flexGrow: bucket.count }}/>)}
      </div>
    </div>
    <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-5 @xl/dash:grid-flow-col @xl/dash:grid-cols-none @xl/dash:auto-cols-fr">
      {buckets.map((bucket) => <div key={bucket.key} className="flex min-w-0 flex-col-reverse justify-end gap-2">
        <dt className={cn('flex items-center gap-1.5 text-[13px] leading-snug', bucket.count ? 'text-neutral-600' : 'text-neutral-500')}>
          <StatusDot tone={bucket.tone} className={bucket.count ? undefined : 'opacity-40'}/>{bucket.label}</dt>
        <dd className="num text-[36px] font-medium leading-none tracking-tight"
          style={{ color: bucket.count ? TONE[bucket.tone].ink : 'var(--color-neutral-500)' }}>
          <img src={stateImage(bucket.key)} alt="" width="56" height="56" decoding="async"
            className={cn('mb-3 block size-14', bucket.count ? undefined : 'opacity-35 grayscale')}/>
          {intro ? <NumberTicker value={bucket.count} duration={0.8}/> : bucket.count}</dd>
      </div>)}
    </dl>
  </section>;
}
